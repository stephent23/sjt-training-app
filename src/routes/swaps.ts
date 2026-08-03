import { Hono } from 'hono';
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
		`SELECT DISTINCT exercise_id FROM logged_sets WHERE exercise_id IN (${samePatternExercises.map(() => '?').join(',') || 'NULL'})`,
	)
		.bind(...samePatternExercises.map((e) => e.id))
		.all<{ exercise_id: number }>();

	const history = new Set(historyRows.map((r) => r.exercise_id));
	const candidates = rankSwapCandidates(samePatternExercises, from, painType, history);

	return c.json({ candidates });
});

swaps.post('/', async (c) => {
	const body = await c.req.json<ApplySwapInput>();

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

	return c.json({ ok: true });
});
