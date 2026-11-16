import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildProgress } from '../src/progress';
import { buildRaceContext } from '../src/raceContext';
import { buildTrainingSummary } from '../src/trainingSummary';
import type { Race } from '../src/types';
import { insertExercise, insertLoggedRun, insertLoggedSet, insertPlannedRun, insertSession } from './fixtures';

// 2026-11-15 is a Sunday: the current week starts Mon 2026-11-09.
const TODAY = '2026-11-15';

const race = (over: Partial<Race>): Race => ({ id: 1, name: 'Brighton Half', date: '2027-03-07', distance_km: 21.1, target_seconds: 6300, result_seconds: null, priority: 'A', ...over });

async function progressFor(races: Race[]) {
	return buildProgress(await buildTrainingSummary(env.DB, TODAY), buildRaceContext(races, TODAY));
}

async function insertRun(date: string, distanceKm: number, seconds: number) {
	const id = await insertSession({ date, kind: 'run', label: 'Run', status: 'completed' });
	await insertPlannedRun(id, { run_type: 'easy' });
	await insertLoggedRun(id, { distance_km: distanceKm, duration_seconds: seconds, performed_on: date });
}

async function insertLift(exerciseId: number, date: string, weightKg: number) {
	const id = await insertSession({ date, kind: 'lift', label: 'Lift', status: 'completed' });
	await insertLoggedSet(id, exerciseId, { weight_kg: weightKg, reps: 5, rir: 2, performed_on: date });
}

describe('buildProgress', () => {
	it('is empty but well-formed with no data: a half marathon goal, 13 weeks, no lifts', async () => {
		const p = await progressFor([]);

		expect(p.goal).toEqual({ race: null, distance_km: 21.1, estimate: null, pb: null, gap_seconds: null });
		expect(p.weeks).toHaveLength(13);
		expect(p.weeks[12]).toEqual({ week_start: '2026-11-09', is_current: true, km: 0, long_run_km: 0, planned: 0, completed: 0 });
		expect(p.lifts).toEqual([]);
		expect(p.adherence_pct).toBeNull();
	});

	it('aims at the next main race even when a tune-up comes first', async () => {
		const p = await progressFor([race({ id: 2, name: 'Tune-up 10K', date: '2027-01-10', distance_km: 10, priority: 'B' }), race({})]);

		expect(p.goal.race).toEqual({ name: 'Brighton Half', date: '2027-03-07', days_until: 112, target_seconds: 6300 });
		expect(p.goal.distance_km).toBe(21.1);
	});

	it('takes the fastest prediction for the goal distance and measures it against the target and the PB', async () => {
		await insertRun('2026-11-03', 10, 3000); // 5:00/km training run
		// The summary reads recent results from the table; the race context takes the rows.
		await env.DB.prepare(`INSERT INTO races (name, date, distance_km, result_seconds) VALUES ('Autumn 10K', '2026-10-04', 10, 2820)`).run();
		const p = await progressFor([
			race({}),
			race({ id: 2, name: 'Autumn 10K', date: '2026-10-04', distance_km: 10, target_seconds: null, result_seconds: 2820, priority: 'B' }),
			race({ id: 3, name: 'Old Half', date: '2024-03-03', distance_km: 21.1, target_seconds: null, result_seconds: 6500, priority: 'A' }),
		]);

		// Riegel from the 47:00 10K race: 2820 * 2.11^1.06 = 6223.
		expect(p.goal.estimate).toEqual({ seconds: 6223, source: 'race', date: '2026-10-04', distance_km: 10, effort_seconds: 2820 });
		expect(p.goal.gap_seconds).toBe(6223 - 6300);
		// The 2024 half is too old to estimate from but is still the best at the distance.
		expect(p.goal.pb).toEqual({ seconds: 6500, date: '2024-03-03', name: 'Old Half' });
	});

	it('reports weekly km and the longest run per week', async () => {
		await insertRun('2026-11-03', 8, 2880);
		await insertRun('2026-11-07', 14, 5040);
		const p = await progressFor([]);

		expect(p.weeks[11]).toMatchObject({ week_start: '2026-11-02', is_current: false, km: 22, long_run_km: 14 });
	});

	it('lists lifts trained in two or more weeks, most-trained first, with the change in e1RM', async () => {
		const squat = await insertExercise({ name: 'Squat' });
		const press = await insertExercise({ name: 'Press' });
		const once = await insertExercise({ name: 'Curl' });
		await insertLift(squat, '2026-10-20', 60);
		await insertLift(squat, '2026-10-27', 62.5);
		await insertLift(squat, '2026-11-03', 66);
		await insertLift(press, '2026-10-21', 40);
		await insertLift(press, '2026-11-04', 38);
		await insertLift(once, '2026-11-05', 12);
		const p = await progressFor([]);

		expect(p.lifts.map((l) => l.name)).toEqual(['Squat', 'Press']);
		expect(p.lifts[0].points.map((pt) => pt.week_start)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
		expect(p.lifts[0]).toMatchObject({ last_e1rm_kg: 77, change_kg: 7 });
		expect(p.lifts[1].change_kg).toBe(-2.4);
	});
});

describe('GET /api/progress', () => {
	it('returns the progress payload', async () => {
		const res = await SELF.fetch('https://training-app.test/api/progress');

		expect(res.status).toBe(200);
		const body = (await res.json()) as { weeks: unknown[]; goal: { distance_km: number } };
		expect(body.weeks).toHaveLength(13);
		expect(body.goal.distance_km).toBe(21.1);
	});
});
