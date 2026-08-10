import { Hono } from 'hono';
import { GOAL_TAGS, type Settings } from '../types';

export const settings = new Hono<{ Bindings: Env }>();

interface SettingsRow {
	goals: string;
	days_per_week: number;
	goal_tags: string;
}

const DEFAULTS: SettingsRow = { goals: '', days_per_week: 5, goal_tags: '[]' };

/** goal_tags is a JSON array in one TEXT column (see migration 0006). A row
 * written before that column existed, or hand-edited, shouldn't 500 the whole
 * settings screen — an unreadable value reads as no tags. */
function parseTags(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
	} catch {
		return [];
	}
}

function toSettings(row: SettingsRow): Settings {
	return { goals: row.goals, days_per_week: row.days_per_week, goal_tags: parseTags(row.goal_tags) };
}

async function readRow(db: D1Database): Promise<SettingsRow> {
	const row = await db.prepare(`SELECT goals, days_per_week, goal_tags FROM settings WHERE id = 1`).first<SettingsRow>();
	return row ?? DEFAULTS;
}

settings.get('/', async (c) => {
	return c.json(toSettings(await readRow(c.env.DB)));
});

settings.patch('/', async (c) => {
	const body = await c.req.json<Partial<Settings>>();

	if (body.days_per_week !== undefined && (!Number.isInteger(body.days_per_week) || body.days_per_week < 1 || body.days_per_week > 7)) {
		return c.json({ error: 'invalid days_per_week' }, 400);
	}
	// Validated here rather than by a CHECK constraint so an unknown slug gets a
	// 400 naming itself, not a D1 constraint violation surfacing as a 500.
	if (body.goal_tags !== undefined) {
		if (!Array.isArray(body.goal_tags)) return c.json({ error: 'invalid goal_tags' }, 400);
		const unknown = body.goal_tags.filter((tag) => !GOAL_TAGS.includes(tag));
		if (unknown.length > 0) return c.json({ error: `unknown goal_tags: ${unknown.join(', ')}` }, 400);
	}

	const current = await readRow(c.env.DB);
	const updated: SettingsRow = {
		goals: body.goals ?? current.goals,
		days_per_week: body.days_per_week ?? current.days_per_week,
		goal_tags: body.goal_tags !== undefined ? JSON.stringify(body.goal_tags) : current.goal_tags,
	};

	await c.env.DB.prepare(`UPDATE settings SET goals = ?, days_per_week = ?, goal_tags = ? WHERE id = 1`)
		.bind(updated.goals, updated.days_per_week, updated.goal_tags)
		.run();

	return c.json(toSettings(updated));
});
