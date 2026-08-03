import { Hono } from 'hono';
import type { Settings } from '../types';

export const settings = new Hono<{ Bindings: Env }>();

settings.get('/', async (c) => {
	const row = await c.env.DB.prepare(`SELECT goals, days_per_week FROM settings WHERE id = 1`).first<Settings>();
	return c.json(row ?? { goals: '', days_per_week: 5 });
});

settings.patch('/', async (c) => {
	const body = await c.req.json<Partial<Settings>>();

	if (body.days_per_week !== undefined && (!Number.isInteger(body.days_per_week) || body.days_per_week < 1 || body.days_per_week > 7)) {
		return c.json({ error: 'invalid days_per_week' }, 400);
	}

	const current = await c.env.DB.prepare(`SELECT goals, days_per_week FROM settings WHERE id = 1`).first<Settings>();
	const goals = body.goals ?? current?.goals ?? '';
	const daysPerWeek = body.days_per_week ?? current?.days_per_week ?? 5;

	await c.env.DB.prepare(`UPDATE settings SET goals = ?, days_per_week = ? WHERE id = 1`).bind(goals, daysPerWeek).run();

	return c.json({ goals, days_per_week: daysPerWeek });
});
