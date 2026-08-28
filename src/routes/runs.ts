// Manual runs: a session recorded by hand, never planned, or a correction to
// one already recorded. See migrations/0008_manual_runs.sql and
// src/types.ts's ManualRunInput for why this is its own route rather than
// riding on sessions.ts's POST /:id/runs (which only ever logs against an
// already-existing session).

import { Hono } from 'hono';
import { validateRunMetrics } from '../runValidation';
import { deleteSessionStatements } from '../sessionDelete';
import { RUN_TYPES } from '../types';
import type { ManualRunInput } from '../types';

export const runs = new Hono<{ Bindings: Env }>();

function capitalize(s: string): string {
	return s[0].toUpperCase() + s.slice(1);
}

/** The week of the nearest existing session on or before `date`; failing
 * that, the nearest session after `date`; failing that (no sessions at all),
 * week 1. A run recorded mid-week belongs to that week, never a new one of
 * its own — see the comment above the inheritance tests in
 * test/runs.route.test.ts. */
async function resolveWeekNumber(db: D1Database, date: string): Promise<number> {
	const before = await db
		.prepare(`SELECT week_number FROM sessions WHERE date <= ?1 ORDER BY date DESC LIMIT 1`)
		.bind(date)
		.first<{ week_number: number }>();
	if (before) return before.week_number;

	const after = await db
		.prepare(`SELECT week_number FROM sessions WHERE date > ?1 ORDER BY date ASC LIMIT 1`)
		.bind(date)
		.first<{ week_number: number }>();
	if (after) return after.week_number;

	return 1;
}

/** Same 400-before-any-write validation for POST (new run) and PUT (correct
 * an existing one) — the shapes are identical. Returns an error message, or
 * null if the body is good to write. */
function validateManualRun(body: Record<string, unknown>): string | null {
	if (typeof body.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return 'invalid date';
	if (!RUN_TYPES.includes(body.run_type as ManualRunInput['run_type'])) return 'invalid run_type';
	if (typeof body.distance_km !== 'number' || !Number.isFinite(body.distance_km) || body.distance_km <= 0) return 'invalid distance_km';
	if (typeof body.duration_seconds !== 'number' || !Number.isInteger(body.duration_seconds) || body.duration_seconds <= 0)
		return 'invalid duration_seconds';
	return validateRunMetrics(body);
}

runs.post('/', async (c) => {
	const body = await c.req.json<ManualRunInput>();

	const error = validateManualRun(body as unknown as Record<string, unknown>);
	if (error) return c.json({ error }, 400);

	const label = `${capitalize(body.run_type)} run`;
	const weekNumber = await resolveWeekNumber(c.env.DB, body.date);

	// A child row needs the parent's generated id, so this can't be one batch:
	// the session insert has to complete before planned_runs/logged_runs can
	// reference it.
	const session = await c.env.DB
		.prepare(`INSERT INTO sessions (date, kind, label, status, week_number, origin) VALUES (?, 'run', ?, 'completed', ?, 'manual') RETURNING id`)
		.bind(body.date, label, weekNumber)
		.first<{ id: number }>();
	const sessionId = session!.id;

	await c.env.DB.batch([
		c.env.DB.prepare(`INSERT INTO planned_runs (session_id, run_type, target_minutes, target_km, structure_json) VALUES (?, ?, NULL, NULL, NULL)`).bind(
			sessionId,
			body.run_type,
		),
		c.env.DB.prepare(
			`INSERT INTO logged_runs (session_id, distance_km, duration_seconds, avg_hr, max_hr, avg_cadence_spm, elevation_gain_m,
			                          aerobic_training_effect, rpe_1_10, performed_on, logged_at, note)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
		).bind(
			sessionId,
			body.distance_km,
			body.duration_seconds,
			body.avg_hr ?? null,
			body.max_hr ?? null,
			body.avg_cadence_spm ?? null,
			body.elevation_gain_m ?? null,
			body.aerobic_training_effect ?? null,
			body.rpe_1_10 ?? null,
			body.date,
			body.note ?? null,
		),
	]);

	return c.json({ id: sessionId });
});

runs.put('/:id', async (c) => {
	const id = Number(c.req.param('id'));
	const body = await c.req.json<ManualRunInput>();

	const error = validateManualRun(body as unknown as Record<string, unknown>);
	if (error) return c.json({ error }, 400);

	const session = await c.env.DB.prepare(`SELECT kind FROM sessions WHERE id = ?`).bind(id).first<{ kind: string }>();
	if (!session) return c.json({ error: 'not found' }, 404);
	if (session.kind !== 'run') return c.json({ error: 'not a run session' }, 409);

	const label = `${capitalize(body.run_type)} run`;

	await c.env.DB.batch([
		c.env.DB.prepare(`UPDATE sessions SET date = ?, label = ? WHERE id = ?`).bind(body.date, label, id),
		c.env.DB.prepare(
			`INSERT INTO planned_runs (session_id, run_type, target_minutes, target_km, structure_json) VALUES (?, ?, NULL, NULL, NULL)
			 ON CONFLICT (session_id) DO UPDATE SET run_type = excluded.run_type`,
		).bind(id, body.run_type),
		c.env.DB.prepare(
			`INSERT INTO logged_runs (session_id, distance_km, duration_seconds, avg_hr, max_hr, avg_cadence_spm, elevation_gain_m,
			                          aerobic_training_effect, rpe_1_10, performed_on, logged_at, note)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
			 ON CONFLICT (session_id) DO UPDATE SET
			   distance_km = excluded.distance_km,
			   duration_seconds = excluded.duration_seconds,
			   avg_hr = excluded.avg_hr,
			   max_hr = excluded.max_hr,
			   avg_cadence_spm = excluded.avg_cadence_spm,
			   elevation_gain_m = excluded.elevation_gain_m,
			   aerobic_training_effect = excluded.aerobic_training_effect,
			   rpe_1_10 = excluded.rpe_1_10,
			   performed_on = excluded.performed_on,
			   logged_at = datetime('now'),
			   note = excluded.note`,
		).bind(
			id,
			body.distance_km,
			body.duration_seconds,
			body.avg_hr ?? null,
			body.max_hr ?? null,
			body.avg_cadence_spm ?? null,
			body.elevation_gain_m ?? null,
			body.aerobic_training_effect ?? null,
			body.rpe_1_10 ?? null,
			body.date,
			body.note ?? null,
		),
	]);

	return c.json({ ok: true });
});

runs.delete('/:id', async (c) => {
	const id = Number(c.req.param('id'));

	const session = await c.env.DB.prepare(`SELECT kind, origin FROM sessions WHERE id = ?`).bind(id).first<{ kind: string; origin: string }>();
	if (!session) return c.json({ error: 'not found' }, 404);
	if (!(session.kind === 'run' && session.origin === 'manual')) return c.json({ error: 'not a manual run' }, 409);

	await c.env.DB.batch(deleteSessionStatements(c.env.DB, [id]));

	return c.json({ ok: true });
});
