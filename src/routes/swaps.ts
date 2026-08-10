import { Hono } from 'hono';
import { sqlIn } from '../sql';
import { rankSwapCandidates, type PainType } from '../swaps';
import type { ApplySwapInput, Exercise } from '../types';

export const swaps = new Hono<{ Bindings: Env }>();

swaps.get('/candidates/:exerciseId', async (c) => {
	const exerciseId = Number(c.req.param('exerciseId'));
	const painParam = c.req.query('pain');
	const painType: PainType = painParam === 'shoulder' || painParam === 'back' ? painParam : null;

	const from = await c.env.DB.prepare(`SELECT * FROM exercises WHERE id = ?`).bind(exerciseId).first<Exercise>();
	if (!from) return c.json({ error: 'not found' }, 404);

	const { results: samePatternExercises } = await c.env.DB.prepare(`SELECT * FROM exercises WHERE pattern = ?`).bind(from.pattern).all<Exercise>();

	const { results: historyRows } = await c.env.DB.prepare(
		`SELECT DISTINCT exercise_id FROM logged_sets WHERE exercise_id IN (${sqlIn(samePatternExercises.length)})`,
	)
		.bind(...samePatternExercises.map((e) => e.id))
		.all<{ exercise_id: number }>();

	const history = new Set(historyRows.map((r) => r.exercise_id));
	const candidates = rankSwapCandidates(samePatternExercises, from, painType, history);

	return c.json({ candidates });
});

swaps.post('/', async (c) => {
	const body = await c.req.json<ApplySwapInput>();

	// Refuse to point two planned_sets rows in one session at the same
	// exercise. logSet and loadSessionDetail both key logged sets by
	// exercise_id, and logged_sets has a unique index on
	// (session_id, exercise_id, set_index) — so duplicates would silently
	// share one set history and overwrite each other's numbers.
	const clash = await c.env.DB.prepare(`SELECT id FROM planned_sets WHERE session_id = ? AND exercise_id = ? AND id != ? LIMIT 1`)
		.bind(body.session_id, body.to_exercise_id, body.planned_set_id)
		.first<{ id: number }>();
	if (clash) return c.json({ error: 'that exercise is already in this session' }, 409);

	await c.env.DB.prepare(
		`INSERT INTO exercise_swaps (session_id, from_exercise_id, to_exercise_id, reason, scope, created_at)
		 VALUES (?, ?, ?, ?, ?, datetime('now'))`,
	)
		.bind(body.session_id, body.from_exercise_id, body.to_exercise_id, body.reason, body.scope)
		.run();

	// Never carry a target weight across a swap — per-hand and total-stack
	// numbers aren't comparable, so the substitute starts from its own history.
	await c.env.DB.prepare(`UPDATE planned_sets SET exercise_id = ?, target_weight_kg = NULL WHERE id = ? AND session_id = ?`)
		.bind(body.to_exercise_id, body.planned_set_id, body.session_id)
		.run();

	// "From now on" used to write its scope to exercise_swaps and do nothing
	// else, so the two options behaved identically and the UI promised a change
	// to future sessions that never happened. It now repoints every planned set
	// still ahead of this session — planned only, so a week already trained
	// keeps the record of what was actually done. Sessions that already contain
	// the substitute are left alone: repointing them would create the duplicate
	// the clash guard above exists to prevent.
	if (body.scope === 'permanent') {
		await c.env.DB.prepare(
			`UPDATE planned_sets SET exercise_id = ?, target_weight_kg = NULL
			 WHERE exercise_id = ?
			   AND session_id IN (
			     SELECT s.id FROM sessions s
			     WHERE s.status = 'planned'
			       AND s.date > (SELECT date FROM sessions WHERE id = ?)
			       AND NOT EXISTS (SELECT 1 FROM planned_sets existing WHERE existing.session_id = s.id AND existing.exercise_id = ?)
			   )`,
		)
			.bind(body.to_exercise_id, body.from_exercise_id, body.session_id, body.to_exercise_id)
			.run();
	}

	return c.json({ ok: true });
});
