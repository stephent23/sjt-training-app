import { Hono } from 'hono';
import { exercises } from './routes/exercises';
import { generator } from './routes/generator';
import { runs } from './routes/runs';
import { sessions } from './routes/sessions';
import { settings } from './routes/settings';
import { swaps } from './routes/swaps';

// The JSON API. Routes talk to D1 directly with prepared statements — no ORM.
export const api = new Hono<{ Bindings: Env }>();

api.get('/health', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM exercises').all<{ n: number }>();
	return c.json({ ok: true, exercises: results[0]?.n ?? 0 });
});

api.route('/sessions', sessions);
api.route('/runs', runs);
api.route('/swaps', swaps);
api.route('/generator', generator);
api.route('/settings', settings);
api.route('/exercises', exercises);
