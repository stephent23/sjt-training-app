import { Hono } from 'hono';
import { isRealIsoDate } from '../generator';
import type { Race, RaceInput } from '../types';

export const races = new Hono<{ Bindings: Env }>();

const COLUMNS = `id, name, date, distance_km, target_seconds, result_seconds, priority`;
const MAX_SECONDS = 200000;

const nullableSeconds = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_SECONDS);

/** Returns the clean input, or the error to send back. */
function parse(body: Partial<RaceInput> | null): RaceInput | string {
	if (!body || typeof body !== 'object') return 'invalid body';
	const name = typeof body.name === 'string' ? body.name.trim() : '';
	if (name.length === 0 || name.length > 80) return 'name must be 1-80 characters';
	if (!isRealIsoDate(body.date)) return 'date must be a real date as YYYY-MM-DD';
	const km = body.distance_km;
	if (typeof km !== 'number' || !Number.isFinite(km) || km <= 0 || km > 500) return 'distance_km must be above 0 and at most 500';
	if (!nullableSeconds(body.target_seconds ?? null)) return 'target_seconds must be null or a positive whole number of seconds';
	if (!nullableSeconds(body.result_seconds ?? null)) return 'result_seconds must be null or a positive whole number of seconds';
	if (body.priority !== 'A' && body.priority !== 'B') return "priority must be 'A' or 'B'";
	return {
		name,
		date: body.date,
		distance_km: km,
		target_seconds: body.target_seconds ?? null,
		result_seconds: body.result_seconds ?? null,
		priority: body.priority,
	};
}

races.get('/', async (c) => {
	const { results } = await c.env.DB.prepare(`SELECT ${COLUMNS} FROM races ORDER BY date, id`).all<Race>();
	return c.json({ races: results });
});

races.post('/', async (c) => {
	const input = parse(await c.req.json<Partial<RaceInput>>().catch(() => null));
	if (typeof input === 'string') return c.json({ error: input }, 400);
	const race = await c.env.DB.prepare(
		`INSERT INTO races (name, date, distance_km, target_seconds, result_seconds, priority) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${COLUMNS}`,
	)
		.bind(input.name, input.date, input.distance_km, input.target_seconds, input.result_seconds, input.priority)
		.first<Race>();
	return c.json({ race });
});

races.put('/:id', async (c) => {
	const id = Number(c.req.param('id'));
	const input = parse(await c.req.json<Partial<RaceInput>>().catch(() => null));
	if (typeof input === 'string') return c.json({ error: input }, 400);
	const race = await c.env.DB.prepare(
		`UPDATE races SET name = ?, date = ?, distance_km = ?, target_seconds = ?, result_seconds = ?, priority = ? WHERE id = ? RETURNING ${COLUMNS}`,
	)
		.bind(input.name, input.date, input.distance_km, input.target_seconds, input.result_seconds, input.priority, id)
		.first<Race>();
	if (!race) return c.json({ error: 'not found' }, 404);
	return c.json({ race });
});

races.delete('/:id', async (c) => {
	const id = Number(c.req.param('id'));
	const res = await c.env.DB.prepare(`DELETE FROM races WHERE id = ?`).bind(id).run();
	if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
	return c.json({ ok: true });
});
