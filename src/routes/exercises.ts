import { Hono } from 'hono';
import { LOADINGS, MODALITIES, type Exercise, type Loading, type Modality } from '../types';

export const exercises = new Hono<{ Bindings: Env }>();

interface CreateExerciseInput {
	name: string;
	pattern: string;
	increment_kg: number;
	modality?: Modality;
	loading?: Loading;
	shoulder_safe?: 0 | 1;
	back_safe?: 0 | 1;
}

/** The movement patterns already in use. Offered as a closed list rather than
 * free text: swap candidates are matched on exact pattern equality, so an
 * exercise with a brand-new pattern would never appear as an alternative to
 * anything, and nothing would ever appear as an alternative to it. */
exercises.get('/patterns', async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT DISTINCT pattern FROM exercises ORDER BY pattern`).all<{ pattern: string }>();
	return c.json({ patterns: results.map((r) => r.pattern) });
});

// Until now nothing in the app could add an exercise — the catalogue was
// whatever the seed put there, so wanting to do something it didn't list meant
// editing SQL. Every CHECK-constrained value is validated here rather than left
// to D1: the sync queue retries 5xx forever, so a constraint violation has to
// come back as a 400.
exercises.post('/', async (c) => {
	const body = await c.req.json<CreateExerciseInput>();

	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (name === '') return c.json({ error: 'name is required' }, 400);

	const known = await c.env.DB.prepare(`SELECT id FROM exercises WHERE pattern = ? LIMIT 1`).bind(body.pattern).first<{ id: number }>();
	if (!known) return c.json({ error: 'pattern must be one of the existing movement patterns' }, 400);

	const modality: Modality = body.modality ?? 'dumbbell';
	if (!MODALITIES.includes(modality)) return c.json({ error: 'invalid modality' }, 400);

	const loading: Loading = body.loading ?? (modality === 'bodyweight' ? 'bodyweight' : modality === 'dumbbell' ? 'per_hand' : 'total');
	if (!LOADINGS.includes(loading)) return c.json({ error: 'invalid loading' }, 400);

	// Bodyweight work has no loadable step, and a non-zero increment there would
	// have progressExercise adding real kilos to a bodyweight prescription.
	const increment = loading === 'bodyweight' ? 0 : Number(body.increment_kg);
	if (!Number.isFinite(increment) || increment < 0 || increment > 50) return c.json({ error: 'invalid increment_kg' }, 400);

	const duplicate = await c.env.DB.prepare(`SELECT id FROM exercises WHERE lower(name) = lower(?) LIMIT 1`)
		.bind(name)
		.first<{ id: number }>();
	if (duplicate) return c.json({ error: `${name} is already in the catalogue` }, 409);

	const row = await c.env.DB.prepare(
		`INSERT INTO exercises (name, modality, pattern, increment_kg, loading, shoulder_safe, back_safe, needs_spotter, is_default)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0) RETURNING *`,
	)
		.bind(name, modality, body.pattern, increment, loading, body.shoulder_safe ?? 1, body.back_safe ?? 1)
		.first<Exercise>();

	return c.json({ exercise: row });
});
