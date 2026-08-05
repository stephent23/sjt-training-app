import { Hono } from 'hono';
import { sqlIn } from '../sql';
import type {
	LoggedRunEntry,
	LoggedSetEntry,
	LogRunInput,
	LogSetInput,
	PlannedSetDetail,
	SessionDetail,
	SessionFeedback,
	SessionRow,
	SessionSummary,
} from '../types';

export const sessions = new Hono<{ Bindings: Env }>();

// Three queries total, regardless of how many exercises a session has. This
// used to run two per planned set (logged + lastWeek), so an 11-exercise
// session cost 23 D1 round-trips to render one screen.
async function loadSessionDetail(db: D1Database, session: SessionRow): Promise<SessionDetail> {
	const { results: plannedSetRows } = await db
		.prepare(
			`SELECT ps.id, ps.exercise_id, e.name AS exercise_name, e.pattern, e.loading, e.increment_kg,
			        ps.order_index, ps.target_sets, ps.rep_low, ps.rep_high, ps.target_weight_kg, ps.rest_seconds, ps.notes,
			        ps.status, ps.superset_group
			 FROM planned_sets ps JOIN exercises e ON e.id = ps.exercise_id
			 WHERE ps.session_id = ?
			 ORDER BY ps.order_index`,
		)
		.bind(session.id)
		.all<Omit<PlannedSetDetail, 'lastWeek' | 'logged'>>();

	const exerciseIds = [...new Set(plannedSetRows.map((row) => row.exercise_id))];

	// Everything logged against THIS session, for every exercise at once.
	const { results: loggedRows } = exerciseIds.length
		? await db
				.prepare(
					`SELECT exercise_id, set_index, weight_kg, reps, rir, rest_taken_seconds, performed_on FROM logged_sets
					 WHERE session_id = ? ORDER BY exercise_id, set_index`,
				)
				.bind(session.id)
				.all<LoggedSetEntry & { exercise_id: number }>()
		: { results: [] as (LoggedSetEntry & { exercise_id: number })[] };

	// "Last week" per exercise = every set from the most recent performed_on
	// that exercise has, ignoring this session. DENSE_RANK partitioned by
	// exercise reproduces the old per-exercise `performed_on = (SELECT MAX(...))`
	// subquery exactly — all rows sharing that latest date rank 1 — but for
	// every exercise in one pass instead of one query each.
	const { results: lastWeekRows } = exerciseIds.length
		? await db
				.prepare(
					`WITH ranked AS (
					   SELECT exercise_id, set_index, weight_kg, reps, rir, rest_taken_seconds, performed_on,
					          DENSE_RANK() OVER (PARTITION BY exercise_id ORDER BY performed_on DESC) AS rnk
					   FROM logged_sets
					   WHERE exercise_id IN (${sqlIn(exerciseIds.length)}) AND session_id != ?
					 )
					 SELECT exercise_id, set_index, weight_kg, reps, rir, rest_taken_seconds, performed_on
					 FROM ranked WHERE rnk = 1 ORDER BY exercise_id, set_index`,
				)
				.bind(...exerciseIds, session.id)
				.all<LoggedSetEntry & { exercise_id: number }>()
		: { results: [] as (LoggedSetEntry & { exercise_id: number })[] };

	function groupByExercise(rows: (LoggedSetEntry & { exercise_id: number })[]): Map<number, LoggedSetEntry[]> {
		const grouped = new Map<number, LoggedSetEntry[]>();
		for (const { exercise_id, ...entry } of rows) {
			const list = grouped.get(exercise_id) ?? [];
			list.push(entry);
			grouped.set(exercise_id, list);
		}
		return grouped;
	}

	const loggedByExercise = groupByExercise(loggedRows);
	const lastWeekByExercise = groupByExercise(lastWeekRows);

	const plannedSets: PlannedSetDetail[] = plannedSetRows.map((row) => ({
		...row,
		logged: loggedByExercise.get(row.exercise_id) ?? [],
		lastWeek: lastWeekByExercise.get(row.exercise_id) ?? [],
	}));

	const plannedRun = await db
		.prepare(`SELECT id, run_type, target_minutes, target_km, structure_json FROM planned_runs WHERE session_id = ?`)
		.bind(session.id)
		.first();

	const loggedRun = await db
		.prepare(`SELECT distance_km, duration_seconds, avg_hr, rpe_1_10, performed_on, note FROM logged_runs WHERE session_id = ?`)
		.bind(session.id)
		.first<LoggedRunEntry>();

	const feedback = await db
		.prepare(`SELECT back_pain_0_3, shoulder_pain_0_3, energy_1_5, note FROM session_feedback WHERE session_id = ?`)
		.bind(session.id)
		.first<SessionFeedback>();

	return {
		session,
		plannedSets,
		plannedRun: (plannedRun as SessionDetail['plannedRun']) ?? null,
		loggedRun: loggedRun ?? null,
		feedback: feedback ?? null,
	};
}

// One aggregate query for the whole list — no N+1 per-session lookups.
// planned_sets fans the join out to one row per exercise, but planned_runs
// and logged_runs are each at-most-one-row-per-session (by convention for
// planned_runs; enforced by a unique index for logged_runs — see
// migrations/0002_logging_unique_constraints.sql), so joining them in does
// not inflate COUNT(DISTINCT ps.id) / SUM(ps.target_sets).
interface SessionSummaryRow extends Omit<SessionSummary, 'has_logged_run'> {
	has_logged_run: number;
}

sessions.get('/', async (c) => {
	const from = c.req.query('from') ?? '0000-01-01';
	const to = c.req.query('to') ?? '9999-12-31';
	const order = c.req.query('order') === 'desc' ? 'DESC' : 'ASC';
	const limitParam = Number(c.req.query('limit'));
	const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 60;

	const { results } = await c.env.DB.prepare(
		// Skipped exercises are excluded from all three counts, so a list row
		// shows the volume you still intend to do rather than the volume
		// originally planned. COUNT(DISTINCT CASE ...) ignores NULLs, so a run
		// session with no planned_sets at all still reports 0 rather than 1.
		// logged_sets has no status column of its own, hence the correlation
		// back to planned_sets on (session_id, exercise_id).
		`SELECT
		   s.id, s.date, s.kind, s.label, s.status, s.week_number,
		   COUNT(DISTINCT CASE WHEN ps.status <> 'skipped' THEN ps.id END) AS exercise_count,
		   COALESCE(SUM(CASE WHEN ps.status <> 'skipped' THEN ps.target_sets END), 0) AS planned_set_count,
		   (SELECT COUNT(*) FROM logged_sets ls
		      WHERE ls.session_id = s.id
		        AND EXISTS (SELECT 1 FROM planned_sets ps2
		                     WHERE ps2.session_id = s.id
		                       AND ps2.exercise_id = ls.exercise_id
		                       AND ps2.status <> 'skipped')) AS logged_set_count,
		   pr.run_type, pr.target_minutes, pr.target_km,
		   (lr.id IS NOT NULL) AS has_logged_run
		 FROM sessions s
		 LEFT JOIN planned_sets ps ON ps.session_id = s.id
		 LEFT JOIN planned_runs pr ON pr.session_id = s.id
		 LEFT JOIN logged_runs  lr ON lr.session_id = s.id
		 WHERE s.date >= ? AND s.date <= ?
		 GROUP BY s.id
		 ORDER BY s.date ${order}
		 LIMIT ?`,
	)
		.bind(from, to, limit)
		.all<SessionSummaryRow>();

	const sessions_: SessionSummary[] = results.map((row) => ({ ...row, has_logged_run: Boolean(row.has_logged_run) }));

	return c.json({ sessions: sessions_ });
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

// Move a session to a different day — a planning-time action (done at home,
// not mid-workout), so unlike logSet/setSessionStatus this isn't routed
// through the offline sync queue; the client awaits it directly.
sessions.patch('/:id/date', async (c) => {
	const id = Number(c.req.param('id'));
	const { date } = await c.req.json<{ date: string }>();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'invalid date' }, 400);
	await c.env.DB.prepare(`UPDATE sessions SET date = ? WHERE id = ?`).bind(date, id).run();
	return c.json({ ok: true });
});

sessions.patch('/:id/exercises/:plannedSetId/status', async (c) => {
	const sessionId = Number(c.req.param('id'));
	const plannedSetId = Number(c.req.param('plannedSetId'));
	const { status } = await c.req.json<{ status: PlannedSetDetail['status'] }>();
	if (!['planned', 'skipped'].includes(status)) return c.json({ error: 'invalid status' }, 400);
	await c.env.DB.prepare(`UPDATE planned_sets SET status = ? WHERE id = ? AND session_id = ?`).bind(status, plannedSetId, sessionId).run();
	return c.json({ ok: true });
});

sessions.post('/:id/sets', async (c) => {
	const sessionId = Number(c.req.param('id'));
	const body = await c.req.json<LogSetInput>();

	// The sync queue drops 4xx responses permanently but retries 5xx forever —
	// a malformed body must fail fast with a 400 here, not fall through to a
	// D1 CHECK-constraint violation that would otherwise 500 and retry forever.
	if (!Number.isFinite(body.weight_kg) || body.weight_kg < 0) return c.json({ error: 'invalid weight_kg' }, 400);
	if (!Number.isInteger(body.reps) || body.reps < 0) return c.json({ error: 'invalid reps' }, 400);
	if (!Number.isInteger(body.rir) || body.rir < 0 || body.rir > 4) return c.json({ error: 'invalid rir' }, 400);

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

// How the session felt. Upserts on session_id (which is the PK), so this goes
// through the same offline-safe queue as set/run logging without ever
// double-inserting on a retry. Every field is optional — someone may only
// want to flag pain, or only energy — but a present value has to be in range,
// rejected with a 400 rather than falling through to a D1 CHECK 500 (which
// the sync queue would then retry forever).
sessions.put('/:id/feedback', async (c) => {
	const sessionId = Number(c.req.param('id'));
	const body = await c.req.json<SessionFeedback>();

	const inRange = (value: number | null | undefined, low: number, high: number): boolean =>
		value === null || value === undefined || (Number.isInteger(value) && value >= low && value <= high);

	if (!inRange(body.back_pain_0_3, 0, 3)) return c.json({ error: 'invalid back_pain_0_3' }, 400);
	if (!inRange(body.shoulder_pain_0_3, 0, 3)) return c.json({ error: 'invalid shoulder_pain_0_3' }, 400);
	if (!inRange(body.energy_1_5, 1, 5)) return c.json({ error: 'invalid energy_1_5' }, 400);

	await c.env.DB.prepare(
		`INSERT INTO session_feedback (session_id, back_pain_0_3, shoulder_pain_0_3, energy_1_5, note)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (session_id) DO UPDATE SET
		   back_pain_0_3 = excluded.back_pain_0_3,
		   shoulder_pain_0_3 = excluded.shoulder_pain_0_3,
		   energy_1_5 = excluded.energy_1_5,
		   note = excluded.note`,
	)
		.bind(sessionId, body.back_pain_0_3 ?? null, body.shoulder_pain_0_3 ?? null, body.energy_1_5 ?? null, body.note ?? null)
		.run();

	return c.json({ ok: true });
});

sessions.post('/:id/runs', async (c) => {
	const sessionId = Number(c.req.param('id'));
	const body = await c.req.json<LogRunInput>();

	if (!Number.isFinite(body.distance_km) || body.distance_km < 0) return c.json({ error: 'invalid distance_km' }, 400);
	if (!Number.isInteger(body.duration_seconds) || body.duration_seconds < 0) return c.json({ error: 'invalid duration_seconds' }, 400);
	if (body.rpe_1_10 !== null && body.rpe_1_10 !== undefined && (!Number.isInteger(body.rpe_1_10) || body.rpe_1_10 < 1 || body.rpe_1_10 > 10))
		return c.json({ error: 'invalid rpe_1_10' }, 400);

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
