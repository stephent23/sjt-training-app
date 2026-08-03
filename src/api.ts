import { Hono } from 'hono';
import { sessions } from './routes/sessions';
import { swaps } from './routes/swaps';

// The JSON API. Routes talk to D1 directly with prepared statements — no ORM.
export const api = new Hono<{ Bindings: Env }>();

api.get('/health', async (c) => {
	const { results } = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM exercises').all<{ n: number }>();
	return c.json({ ok: true, exercises: results[0]?.n ?? 0 });
});

api.route('/sessions', sessions);
api.route('/swaps', swaps);
