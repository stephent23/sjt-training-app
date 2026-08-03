import { Hono } from 'hono';
import type { LoggedRunEntry, LoggedSetEntry, LogRunInput, LogSetInput, PlannedSetDetail, SessionDetail, SessionRow } from '../types';

export const sessions = new Hono<{ Bindings: Env }>();

async function loadSessionDetail(db: D1Database, session: SessionRow): Promise<SessionDetail> {
	const { results: plannedSetRows } = await db
		.prepare(
			`SELECT ps.id, ps.exercise_id, e.name AS exercise_name, e.pattern, e.loading, e.increment_kg,
			        ps.order_index, ps.target_sets, ps.rep_low, ps.rep_high, ps.target_weight_kg, ps.rest_seconds, ps.notes
			 FROM planned_sets ps JOIN exercises e ON e.id = ps.exercise_id
			 WHERE ps.session_id = ?
			 ORDER BY ps.order_index`,
		)
		.bind(session.id)
		.all<Omit<PlannedSetDetail, 'lastWeek' | 'logged'>>();

	const plannedSets: PlannedSetDetail[] = [];
	for (const row of plannedSetRows) {
		const { results: logged } = await db
			.prepare(
				`SELECT set_index, weight_kg, reps, rir, rest_taken_seconds FROM logged_sets
				 WHERE session_id = ? AND exercise_id = ? ORDER BY set_index`,
			)
			.bind(session.id, row.exercise_id)
			.all<LoggedSetEntry>();

		const { results: lastWeek } = await db
			.prepare(
				`SELECT set_index, weight_kg, reps, rir, rest_taken_seconds FROM logged_sets
				 WHERE exercise_id = ? AND session_id != ? AND performed_on = (
				   SELECT MAX(performed_on) FROM logged_sets WHERE exercise_id = ? AND session_id != ?
				 )
				 ORDER BY set_index`,
			)
			.bind(row.exercise_id, session.id, row.exercise_id, session.id)
			.all<LoggedSetEntry>();

		plannedSets.push({ ...row, logged, lastWeek });
	}

	const plannedRun = await db
		.prepare(`SELECT id, run_type, target_minutes, target_km, structure_json FROM planned_runs WHERE session_id = ?`)
		.bind(session.id)
		.first();

	const loggedRun = await db
		.prepare(`SELECT distance_km, duration_seconds, avg_hr, rpe_1_10, performed_on, note FROM logged_runs WHERE session_id = ?`)
		.bind(session.id)
		.first<LoggedRunEntry>();

	return { session, plannedSets, plannedRun: (plannedRun as SessionDetail['plannedRun']) ?? null, loggedRun: loggedRun ?? null };
}

sessions.get('/today', async (c) => {
	const today = new Date().toISOString().slice(0, 10);

	let session = await c.env.DB.prepare(`SELECT * FROM sessions WHERE date = ? AND status = 'planned' LIMIT 1`).bind(today).first<SessionRow>();

	if (!session) {
		session = await c.env.DB.prepare(`SELECT * FROM sessions WHERE date >= ? AND status = 'planned' ORDER BY date LIMIT 1`)
			.bind(today)
			.first<SessionRow>();
	}

	if (!session) {
		session = await c.env.DB.prepare(`SELECT * FROM sessions ORDER BY date DESC LIMIT 1`).first<SessionRow>();
	}

	if (!session) return c.json({ session: null }, 200);

	return c.json(await loadSessionDetail(c.env.DB, session));
});

sessions.get('/:id', async (c) => {
	const id = Number(c.req.param('id'));
	const session = await c.env.DB.prepare(`SELECT * FROM sessions WHERE id = ?`).bind(id).first<SessionRow>();
	if (!session) return c.json({ error: 'not found' }, 404);
	return c.json(await loadSessionDetail(c.env.DB, session));
});

sessions.patch('/:id/status', async (c) => {
	const id = Number(c.req.param('id'));
	const { status } = await c.req.json<{ status: SessionRow['status'] }>();
	if (!['planned', 'completed', 'skipped'].includes(status)) return c.json({ error: 'invalid status' }, 400);
	await c.env.DB.prepare(`UPDATE sessions SET status = ? WHERE id = ?`).bind(status, id).run();
	return c.json({ ok: true });
});

sessions.post('/:id/sets', async (c) => {
	const sessionId = Number(c.req.param('id'));
	const body = await c.req.json<LogSetInput>();

	await c.env.DB.prepare(
		`INSERT INTO logged_sets (session_id, exercise_id, set_index, weight_kg, reps, rir, rest_taken_seconds, performed_on, logged_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
		 ON CONFLICT (session_id, exercise_id, set_index) DO UPDATE SET
		   weight_kg = excluded.weight_kg,
		   reps = excluded.reps,
		   rir = excluded.rir,
		   rest_taken_seconds = excluded.rest_taken_seconds,
		   performed_on = excluded.performed_on,
		   logged_at = datetime('now')`,
	)
		.bind(sessionId, body.exercise_id, body.set_index, body.weight_kg, body.reps, body.rir, body.rest_taken_seconds, body.performed_on)
		.run();

	return c.json({ ok: true });
});

sessions.post('/:id/runs', async (c) => {
	const sessionId = Number(c.req.param('id'));
	const body = await c.req.json<LogRunInput>();

	await c.env.DB.prepare(
		`INSERT INTO logged_runs (session_id, distance_km, duration_seconds, avg_hr, rpe_1_10, performed_on, logged_at, note)
		 VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?)
		 ON CONFLICT (session_id) DO UPDATE SET
		   distance_km = excluded.distance_km,
		   duration_seconds = excluded.duration_seconds,
		   avg_hr = excluded.avg_hr,
		   rpe_1_10 = excluded.rpe_1_10,
		   performed_on = excluded.performed_on,
		   logged_at = datetime('now'),
		   note = excluded.note`,
	)
		.bind(sessionId, body.distance_km, body.duration_seconds, body.avg_hr, body.rpe_1_10, body.performed_on, body.note)
		.run();

	return c.json({ ok: true });
});
