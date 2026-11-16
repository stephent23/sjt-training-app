import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildRaceContext } from '../src/raceContext';
import { addDaysIso } from '../src/dates';
import type { Race, RaceInput } from '../src/types';
import { insertSession, todayIso } from './fixtures';

const URL = 'https://training-app.test/api/races';
const base: RaceInput = { name: 'Spring Half', date: '2027-04-18', distance_km: 21.1, target_seconds: 6000, result_seconds: null, priority: 'A' };

function send(method: string, url: string, body?: unknown) {
	return SELF.fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe('/api/races', () => {
	it('creates, lists by date, updates and deletes', async () => {
		const later = await (await send('POST', URL, { ...base, name: 'Later', date: '2027-06-01' })).json() as { race: Race };
		const first = await (await send('POST', URL, base)).json() as { race: Race };
		expect(first.race).toMatchObject({ name: 'Spring Half', priority: 'A', result_seconds: null });

		const list = await (await SELF.fetch(URL)).json() as { races: Race[] };
		expect(list.races.map((r) => r.name)).toEqual(['Spring Half', 'Later']);

		const put = await send('PUT', `${URL}/${first.race.id}`, { ...base, result_seconds: 5900 });
		expect(((await put.json()) as { race: Race }).race.result_seconds).toBe(5900);

		expect((await send('DELETE', `${URL}/${later.race.id}`)).status).toBe(200);
		expect((await send('DELETE', `${URL}/${later.race.id}`)).status).toBe(404);
		expect((await send('PUT', `${URL}/9999`, base)).status).toBe(404);
	});

	it.each<[string, Record<string, unknown>]>([
		['empty name', { name: '  ' }],
		['long name', { name: 'x'.repeat(81) }],
		['impossible date', { date: '2027-02-30' }],
		['zero distance', { distance_km: 0 }],
		['huge distance', { distance_km: 501 }],
		['fractional target', { target_seconds: 99.5 }],
		['zero target', { target_seconds: 0 }],
		['huge result', { result_seconds: 200001 }],
		['bad priority', { priority: 'C' }],
	])('rejects %s', async (_label, patch) => {
		const res = await send('POST', URL, { ...base, ...patch });
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBeTruthy();
	});
});

describe('buildRaceContext', () => {
	const row = (o: Partial<Race>): Race => ({ id: 1, name: 'R', date: '2027-01-01', distance_km: 10, target_seconds: null, result_seconds: null, priority: 'A', ...o });

	it('derives pace and countdown for upcoming races, soonest first', () => {
		const ctx = buildRaceContext([row({ name: 'B', date: '2026-12-31', distance_km: 21.1, target_seconds: 6330 }), row({ name: 'A', date: '2026-11-25' })], '2026-11-15');
		expect(ctx.races.map((r) => r.name)).toEqual(['A', 'B']);
		expect(ctx.races[0]).toMatchObject({ target_pace_seconds_per_km: null, days_until: 10, weeks_until: 1 });
		expect(ctx.races[1]).toMatchObject({ target_pace_seconds_per_km: 300, days_until: 46, weeks_until: 6 });
	});

	it('splits history from goals and keeps the fastest result per distance', () => {
		const ctx = buildRaceContext(
			[
				row({ id: 1, name: 'Old 10k', date: '2026-03-01', result_seconds: 3000 }),
				row({ id: 2, name: 'Newer 10k', date: '2026-09-01', result_seconds: 2900 }),
				row({ id: 3, name: 'Slow 10k', date: '2026-10-01', result_seconds: 3100 }),
				row({ id: 4, name: 'Half', date: '2026-10-10', distance_km: 21.1, result_seconds: 6330 }),
				row({ id: 5, name: 'Missed', date: '2026-10-20' }),
			],
			'2026-11-15',
		);
		expect(ctx.races).toEqual([]);
		expect(ctx.raceResults.map((r) => r.name)).toEqual(['Half', 'Slow 10k', 'Newer 10k', 'Old 10k']);
		expect(ctx.raceResults[0]).toMatchObject({ name: 'Half', pace_seconds_per_km: 300 });
		expect(ctx.personalBests).toMatchObject([
			{ distance_km: 10, result_seconds: 2900, pace_seconds_per_km: 290, name: 'Newer 10k' },
			{ distance_km: 21.1, result_seconds: 6330 },
		]);
	});
});

describe('GET /api/generator/export — race context', () => {
	it('carries races, results, personal bests and the athlete anchors', async () => {
		const today = todayIso();
		await send('POST', URL, { ...base, date: addDaysIso(today, 70), target_seconds: 6330 });
		await send('POST', URL, { ...base, name: 'Past 10k', date: addDaysIso(today, -30), distance_km: 10, target_seconds: null, result_seconds: 3000 });
		await send('PATCH', 'https://training-app.test/api/settings', { max_hr: 190 });

		const body = (await (await SELF.fetch('https://training-app.test/api/generator/export')).json()) as Record<string, any>;
		expect(body.races).toHaveLength(1);
		expect(body.races[0]).toMatchObject({ name: 'Spring Half', days_until: 70, weeks_until: 10, target_pace_seconds_per_km: 300 });
		expect(body.raceResults).toMatchObject([{ name: 'Past 10k', pace_seconds_per_km: 300 }]);
		expect(body.personalBests).toMatchObject([{ distance_km: 10, result_seconds: 3000 }]);
		expect(body.athlete).toEqual({ max_hr: 190, resting_hr: null, vo2max: null, threshold_pace_seconds_per_km: null, threshold_hr: null });
	});
});

describe('old results and PB buckets', () => {
	const row = (o: Partial<Race>): Race => ({ id: 1, name: 'R', date: '2027-01-01', distance_km: 10, target_seconds: null, result_seconds: null, priority: 'A', ...o });

	it('compares 21.0975 and 21.1 as one distance but keeps each row distance', () => {
		const ctx = buildRaceContext(
			[
				row({ id: 1, name: 'Typed', date: '2026-05-01', distance_km: 21.0975, result_seconds: 6200 }),
				row({ id: 2, name: 'Picked', date: '2026-10-01', distance_km: 21.1, result_seconds: 6100 }),
			],
			'2026-11-15',
		);
		expect(ctx.personalBests).toHaveLength(1);
		expect(ctx.personalBests[0]).toMatchObject({ name: 'Picked', distance_km: 21.1 });
		expect(ctx.raceResults.map((r) => r.distance_km)).toEqual([21.1, 21.0975]);
	});

	it('lists a result dated today once, and past races without a time separately', () => {
		const ctx = buildRaceContext(
			[
				row({ id: 1, name: 'Today', date: '2026-11-15', result_seconds: 3000 }),
				row({ id: 2, name: 'No time', date: '2026-09-01' }),
				row({ id: 3, name: 'Today goal', date: '2026-11-15' }),
			],
			'2026-11-15',
		);
		expect(ctx.raceResults.map((r) => r.name)).toEqual(['Today']);
		expect(ctx.races.map((r) => r.name)).toEqual(['Today goal']);
		expect(ctx.racesWithoutTime).toEqual([{ name: 'No time', date: '2026-09-01', distance_km: 10 }]);
	});

	it('export keeps a result from two years ago out of race_estimates but in results and PBs', async () => {
		const today = todayIso();
		await send('POST', URL, { ...base, name: 'Old half', date: addDaysIso(today, -730), distance_km: 21.0975, target_seconds: null, result_seconds: 6000 });
		await send('POST', URL, { ...base, name: 'Recent 10k', date: addDaysIso(today, -20), distance_km: 10, target_seconds: null, result_seconds: 2800 });
		const body = (await (await SELF.fetch('https://training-app.test/api/generator/export')).json()) as Record<string, any>;
		expect(body.raceResults.map((r: any) => r.name)).toEqual(['Recent 10k', 'Old half']);
		expect(body.personalBests.map((r: any) => r.name)).toEqual(['Recent 10k', 'Old half']);
		const sources = body.trainingSummary.run_fitness.race_estimates.filter((e: any) => e.source === 'race');
		expect(sources).toHaveLength(1);
		expect(sources[0].date).toBe(addDaysIso(today, -20));
	});
});

describe('GET /api/generator/export — sessionNotes', () => {
	async function feedback(date: string, note: string | null, energy: number | null = null, kind: 'lift' | 'run' = 'lift') {
		const id = await insertSession({ date, kind, label: `S ${date}`, status: 'completed' });
		await env.DB.prepare(`INSERT INTO session_feedback (session_id, note, energy_1_5) VALUES (?, ?, ?)`).bind(id, note, energy).run();
	}

	it('returns recent non-empty notes newest first, truncated, with energy only when set', async () => {
		const today = todayIso();
		await feedback(addDaysIso(today, -10), 'older note', 3);
		await feedback(addDaysIso(today, -2), 'x'.repeat(500), null, 'run');
		await feedback(addDaysIso(today, -3), '   ');
		await feedback(addDaysIso(today, -4), null);
		await feedback(addDaysIso(today, -50), 'too old');
		const body = (await (await SELF.fetch('https://training-app.test/api/generator/export')).json()) as Record<string, any>;
		expect(body.sessionNotes).toHaveLength(2);
		expect(body.sessionNotes[0]).toEqual({ date: addDaysIso(today, -2), kind: 'run', label: `S ${addDaysIso(today, -2)}`, note: 'x'.repeat(400) });
		expect(body.sessionNotes[1]).toMatchObject({ note: 'older note', energy_1_5: 3, kind: 'lift' });
	});

	it('caps at 30 entries', async () => {
		const today = todayIso();
		for (let i = 0; i < 32; i++) await feedback(addDaysIso(today, -(i % 20)), `n${i}`);
		const body = (await (await SELF.fetch('https://training-app.test/api/generator/export')).json()) as Record<string, any>;
		expect(body.sessionNotes).toHaveLength(30);
	});
});
