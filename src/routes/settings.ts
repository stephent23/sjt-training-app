import { Hono } from 'hono';
import { ATHLETE_FIELDS, GOAL_TAGS, parseGoalTags, type Athlete, type Settings } from '../types';

export const settings = new Hono<{ Bindings: Env }>();

interface SettingsRow extends Athlete {
	goals: string;
	days_per_week: number;
	goal_tags: string;
}

const ATHLETE_KEYS = ATHLETE_FIELDS.map((f) => f.key);
const COLUMNS = ['goals', 'days_per_week', 'goal_tags', ...ATHLETE_KEYS] as const;

const NO_ATHLETE = Object.fromEntries(ATHLETE_KEYS.map((key) => [key, null])) as Athlete;
const DEFAULTS: SettingsRow = { goals: '', days_per_week: 5, goal_tags: '[]', ...NO_ATHLETE };

function toSettings(row: SettingsRow): Settings {
	return { ...row, goal_tags: parseGoalTags(row.goal_tags) };
}

async function readRow(db: D1Database): Promise<SettingsRow> {
	const row = await db.prepare(`SELECT ${COLUMNS.join(', ')} FROM settings WHERE id = 1`).first<SettingsRow>();
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

	// null clears an athlete number; undefined leaves it alone.
	for (const field of ATHLETE_FIELDS) {
		const v = body[field.key];
		if (v === undefined || v === null) continue;
		const ok = typeof v === 'number' && Number.isFinite(v) && v >= field.min && v <= field.max && (!field.integer || Number.isInteger(v));
		if (!ok) return c.json({ error: `invalid ${field.key}` }, 400);
	}

	const current = await readRow(c.env.DB);
	const updated: SettingsRow = {
		goals: body.goals ?? current.goals,
		days_per_week: body.days_per_week ?? current.days_per_week,
		goal_tags: body.goal_tags !== undefined ? JSON.stringify(body.goal_tags) : current.goal_tags,
		...(Object.fromEntries(ATHLETE_KEYS.map((key) => [key, body[key] !== undefined ? body[key] : current[key]])) as Athlete),
	};

	await c.env.DB.prepare(`UPDATE settings SET ${COLUMNS.map((column) => `${column} = ?`).join(', ')} WHERE id = 1`)
		.bind(...COLUMNS.map((column) => updated[column]))
		.run();

	return c.json(toSettings(updated));
});
