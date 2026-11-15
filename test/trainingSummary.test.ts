import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildTrainingSummary, type WeekSummary } from '../src/trainingSummary';
import { insertExercise, insertLoggedRun, insertLoggedSet, insertPlannedRun, insertSession } from './fixtures';

// 2026-11-15 is a Sunday, so the current week is Mon 2026-11-09 .. Sun 11-15
// and the default 12-week window starts Mon 2026-08-17.
const TODAY = '2026-11-15';
const CURRENT_WEEK = '2026-11-09';

function week(summary: { weeks: WeekSummary[] }, weekStart: string): WeekSummary {
	const found = summary.weeks.find((w) => w.week_start === weekStart);
	if (!found) throw new Error(`no bucket for ${weekStart}`);
	return found;
}

async function insertRace(date: string, distanceKm: number, resultSeconds: number | null): Promise<void> {
	await env.DB.prepare(`INSERT INTO races (name, date, distance_km, result_seconds) VALUES (?, ?, ?, ?)`)
		.bind('Test race', date, distanceKm, resultSeconds)
		.run();
}

/** A completed run session; `type` adds the planned_runs row that gives it a run type. */
async function insertRun(
	date: string,
	run: { distance_km: number; duration_seconds: number; avg_hr?: number | null },
	type: 'easy' | 'tempo' | 'intervals' | 'long' | null = 'easy',
): Promise<void> {
	const id = await insertSession({ date, kind: 'run', label: 'Run', status: 'completed', origin: type === null ? 'manual' : 'planned' });
	if (type !== null) await insertPlannedRun(id, { run_type: type });
	await insertLoggedRun(id, { ...run, avg_hr: run.avg_hr ?? null, performed_on: date });
}

async function insertFeedback(sessionId: number, shoulder: number | null, back: number | null): Promise<void> {
	await env.DB.prepare(`INSERT INTO session_feedback (session_id, back_pain_0_3, shoulder_pain_0_3) VALUES (?, ?, ?)`)
		.bind(sessionId, back, shoulder)
		.run();
}

describe('buildTrainingSummary — window and empty database', () => {
	it('returns 13 zeroed weeks, oldest first, when there is no data', async () => {
		const summary = await buildTrainingSummary(env.DB, TODAY);

		expect(summary.window_start).toBe('2026-08-17');
		expect(summary.current_week_start).toBe(CURRENT_WEEK);
		expect(summary.weeks).toHaveLength(13);
		expect(summary.weeks[0].week_start).toBe('2026-08-17');
		expect(summary.weeks[12].week_start).toBe(CURRENT_WEEK);
		expect(summary.weeks.map((w) => w.is_current)).toEqual([...Array(12).fill(false), true]);

		for (const w of summary.weeks) {
			expect(w.adherence).toEqual({ planned: 0, completed: 0, skipped: 0 });
			expect(w.lifting).toEqual({ exercises: [], hard_sets_by_pattern: {} });
			expect(w.running).toEqual({ km: 0, runs: 0, long_run_km: 0, avg_rpe: null, avg_hr: null });
			expect(w.pain).toEqual({ max_shoulder: null, max_back: null });
		}
		// Twelve full weeks exist, so the km trend is present and reads zero.
		expect(summary.trends).toEqual({
			exercises: [],
			weekly_km: { first_week: '2026-08-17', last_week: '2026-11-02', first_km: 0, last_km: 0, change_km: 0, change_pct: null },
			adherence_pct: null,
		});
	});

	it('honours a custom week count: weeks full weeks plus the current one', async () => {
		const summary = await buildTrainingSummary(env.DB, TODAY, 2);

		expect(summary.weeks.map((w) => w.week_start)).toEqual(['2026-10-26', '2026-11-02', CURRENT_WEEK]);
	});

	it('keeps a gap week in the output as zeros', async () => {
		const liftId = await insertSession({ date: '2026-08-17', label: 'Lift A', status: 'completed', week_number: 1 });
		const squat = await insertExercise({ name: 'Squat', pattern: 'squat' });
		await insertLoggedSet(liftId, squat, { weight_kg: 100, reps: 5, rir: 2, performed_on: '2026-08-17' });

		const runId = await insertSession({ date: '2026-11-02', kind: 'run', label: 'Easy', status: 'completed', week_number: 2 });
		await insertLoggedRun(runId, { distance_km: 6, performed_on: '2026-11-03' });

		const summary = await buildTrainingSummary(env.DB, TODAY);
		const gap = week(summary, '2026-09-07');

		expect(gap.adherence).toEqual({ planned: 0, completed: 0, skipped: 0 });
		expect(gap.lifting).toEqual({ exercises: [], hard_sets_by_pattern: {} });
		expect(gap.running.km).toBe(0);
		expect(gap.running.runs).toBe(0);
		expect(week(summary, '2026-08-17').lifting.exercises).toHaveLength(1);
		expect(week(summary, '2026-11-02').running.km).toBe(6);
	});
});

describe('buildTrainingSummary — lifting', () => {
	it('tracks e1RM trend from first to last week with logs, using the best set of each week', async () => {
		const squat = await insertExercise({ name: 'Squat', pattern: 'squat' });

		// Week of 2026-09-07: 100x5 (e1RM 116.7) and 90x10 (e1RM 120.0). Best e1RM
		// comes from the 90x10 set; top weight from the 100x5 set.
		const earlyId = await insertSession({ date: '2026-09-07', label: 'Lift A', status: 'completed' });
		await insertLoggedSet(earlyId, squat, { set_index: 1, weight_kg: 100, reps: 5, rir: 2, performed_on: '2026-09-07' });
		await insertLoggedSet(earlyId, squat, { set_index: 2, weight_kg: 90, reps: 10, rir: 4, performed_on: '2026-09-08' });

		// Week of 2026-11-02: 110x5 (e1RM 128.3).
		const lateId = await insertSession({ date: '2026-11-02', label: 'Lift A', status: 'completed' });
		await insertLoggedSet(lateId, squat, { set_index: 1, weight_kg: 110, reps: 5, rir: 2, performed_on: '2026-11-02' });

		const summary = await buildTrainingSummary(env.DB, TODAY);

		const early = week(summary, '2026-09-07').lifting;
		expect(early.exercises).toEqual([{ exercise_id: squat, name: 'Squat', best_e1rm_kg: 120, top_weight_kg: 100 }]);
		// rir 4 is outside the hard-set band (RIR <= 3); rir 2 is inside.
		expect(early.hard_sets_by_pattern).toEqual({ squat: 1 });

		expect(summary.trends.exercises).toEqual([
			{
				exercise_id: squat,
				name: 'Squat',
				first_week: '2026-09-07',
				last_week: '2026-11-02',
				first_e1rm_kg: 120,
				last_e1rm_kg: 128.3,
				change_kg: 8.3,
				change_pct: 6.9,
			},
		]);
	});

	it('leaves change null for an exercise logged in only one week', async () => {
		const bench = await insertExercise({ name: 'Bench', pattern: 'horizontal_push' });
		const id = await insertSession({ date: '2026-10-05', label: 'Lift B', status: 'completed' });
		await insertLoggedSet(id, bench, { weight_kg: 60, reps: 8, rir: 2, performed_on: '2026-10-05' });

		const summary = await buildTrainingSummary(env.DB, TODAY);

		expect(summary.trends.exercises).toHaveLength(1);
		expect(summary.trends.exercises[0].change_kg).toBeNull();
		expect(summary.trends.exercises[0].change_pct).toBeNull();
	});
});

describe('buildTrainingSummary — running', () => {
	it('totals km, counts runs, takes the long run, and averages RPE and HR', async () => {
		// Week of 2026-10-26: 5 km (RPE 4, HR 140) and 8.5 km (RPE 6, HR 150).
		const a = await insertSession({ date: '2026-10-26', kind: 'run', label: 'Easy', status: 'completed' });
		await insertLoggedRun(a, { distance_km: 5, rpe_1_10: 4, avg_hr: 140, performed_on: '2026-10-26' });
		const b = await insertSession({ date: '2026-10-29', kind: 'run', label: 'Long', status: 'completed' });
		await insertLoggedRun(b, { distance_km: 8.5, rpe_1_10: 6, avg_hr: 150, performed_on: '2026-10-29' });

		// Week of 2026-08-17: 4 km, the first full week.
		const first = await insertSession({ date: '2026-08-18', kind: 'run', label: 'Easy', status: 'completed' });
		await insertLoggedRun(first, { distance_km: 4, performed_on: '2026-08-18' });

		// Week of 2026-11-02: 6 km, the last full week.
		const last = await insertSession({ date: '2026-11-03', kind: 'run', label: 'Easy', status: 'completed' });
		await insertLoggedRun(last, { distance_km: 6, performed_on: '2026-11-03' });

		// Current week so far: 20 km. Shown in its own bucket, but not in the km trend.
		const current = await insertSession({ date: '2026-11-10', kind: 'run', label: 'Long', status: 'completed' });
		await insertLoggedRun(current, { distance_km: 20, performed_on: '2026-11-10' });

		const summary = await buildTrainingSummary(env.DB, TODAY);

		expect(week(summary, '2026-10-26').running).toEqual({ km: 13.5, runs: 2, long_run_km: 8.5, avg_rpe: 5, avg_hr: 145 });
		expect(week(summary, CURRENT_WEEK).running.km).toBe(20);
		expect(summary.trends.weekly_km).toEqual({
			first_week: '2026-08-17',
			last_week: '2026-11-02',
			first_km: 4,
			last_km: 6,
			change_km: 2,
			change_pct: 50,
		});
	});

	it('gives a null weekly km trend with fewer than two full weeks', async () => {
		const summary = await buildTrainingSummary(env.DB, TODAY, 1);

		expect(summary.trends.weekly_km).toBeNull();
	});
});

describe('buildTrainingSummary — adherence', () => {
	it('counts planned, completed and skipped sessions, and excludes manual runs', async () => {
		// Week of 2026-09-21: two completed, one skipped.
		await insertSession({ date: '2026-09-21', label: 'Lift A', status: 'completed' });
		await insertSession({ date: '2026-09-23', label: 'Lift B', status: 'completed' });
		await insertSession({ date: '2026-09-25', label: 'Lift C', status: 'skipped' });
		// A manual run in the same week is not part of the plan, so it does not count.
		await insertSession({ date: '2026-09-22', kind: 'run', label: 'Unplanned 5k', status: 'completed', origin: 'manual' });

		// Week of 2026-10-05: two completed.
		await insertSession({ date: '2026-10-05', label: 'Lift A', status: 'completed' });
		await insertSession({ date: '2026-10-07', label: 'Lift B', status: 'completed' });

		const summary = await buildTrainingSummary(env.DB, TODAY);

		expect(week(summary, '2026-09-21').adherence).toEqual({ planned: 3, completed: 2, skipped: 1 });
		expect(week(summary, '2026-10-05').adherence).toEqual({ planned: 2, completed: 2, skipped: 0 });
		// 4 completed out of 5 planned across the window.
		expect(summary.trends.adherence_pct).toBe(80);
	});
});

describe('buildTrainingSummary — pain', () => {
	it('takes the max shoulder and back score per week from session feedback', async () => {
		const a = await insertSession({ date: '2026-09-28', label: 'Lift A', status: 'completed' });
		await insertFeedback(a, 1, 0);
		const b = await insertSession({ date: '2026-09-30', label: 'Lift B', status: 'completed' });
		await insertFeedback(b, 3, 2);
		// A session in the next week with no feedback row at all.
		await insertSession({ date: '2026-10-05', label: 'Lift A', status: 'completed' });

		const summary = await buildTrainingSummary(env.DB, TODAY);

		expect(week(summary, '2026-09-28').pain).toEqual({ max_shoulder: 3, max_back: 2 });
		expect(week(summary, '2026-10-05').pain).toEqual({ max_shoulder: null, max_back: null });
	});
});

describe('buildTrainingSummary — future data', () => {
	it('excludes sessions, sets and runs dated after today', async () => {
		const squat = await insertExercise({ name: 'Squat', pattern: 'squat' });

		// Monday after "today": a completed session with a logged set and a logged run.
		const futureLift = await insertSession({ date: '2026-11-16', label: 'Lift A', status: 'completed' });
		await insertLoggedSet(futureLift, squat, { weight_kg: 200, reps: 1, rir: 1, performed_on: '2026-11-16' });
		const futureRun = await insertSession({ date: '2026-11-20', kind: 'run', label: 'Long', status: 'completed' });
		await insertLoggedRun(futureRun, { distance_km: 30, performed_on: '2026-11-20' });
		// A planned session later still.
		await insertSession({ date: '2026-11-25', label: 'Lift B', status: 'planned' });

		const summary = await buildTrainingSummary(env.DB, TODAY);

		expect(summary.weeks.reduce((sum, w) => sum + w.adherence.planned, 0)).toBe(0);
		expect(summary.weeks.reduce((sum, w) => sum + w.running.km, 0)).toBe(0);
		expect(summary.weeks.every((w) => w.lifting.exercises.length === 0)).toBe(true);
		expect(summary.trends.exercises).toEqual([]);
		expect(summary.trends.adherence_pct).toBeNull();
		expect(summary.trends.weekly_km?.last_km).toBe(0);
	});
});

describe('buildTrainingSummary — run fitness', () => {
	it('is empty but well formed with no data', async () => {
		const emptyType = { runs: 0, km: 0, avg_pace_seconds_per_km: null, avg_hr: null };
		const summary = await buildTrainingSummary(env.DB, TODAY);

		expect(summary.run_fitness).toEqual({
			by_type: { easy: emptyType, tempo: emptyType, intervals: emptyType, long: emptyType },
			easy_pace_trend: { first_seconds_per_km: null, last_seconds_per_km: null, first_avg_hr: null, last_avg_hr: null },
			best_efforts: [],
			race_estimates: [],
			longest_run_km: 0,
			weeks_with_long_run_over_16km: 0,
		});
	});

	it('aggregates pace and HR by run type, skipping runs with no type and zero-duration runs', async () => {
		await insertRun('2026-10-06', { distance_km: 10, duration_seconds: 3000, avg_hr: 140 }, 'easy');
		await insertRun('2026-11-03', { distance_km: 5, duration_seconds: 1650, avg_hr: 150 }, 'easy');
		await insertRun('2026-10-08', { distance_km: 8, duration_seconds: 2800 }, 'tempo');
		// A manual run with no planned_runs row has no type, so it is left out of by_type.
		await insertRun('2026-10-10', { distance_km: 4, duration_seconds: 1400, avg_hr: 170 }, null);
		// Zero duration is ignored everywhere in run fitness.
		await insertRun('2026-10-12', { distance_km: 6, duration_seconds: 0 }, 'easy');

		const { by_type } = (await buildTrainingSummary(env.DB, TODAY)).run_fitness;

		// 15 km in 4650 s = 310 s/km; HR (140 + 150) / 2.
		expect(by_type.easy).toEqual({ runs: 2, km: 15, avg_pace_seconds_per_km: 310, avg_hr: 145 });
		expect(by_type.tempo).toEqual({ runs: 1, km: 8, avg_pace_seconds_per_km: 350, avg_hr: null });
		expect(by_type.intervals).toEqual({ runs: 0, km: 0, avg_pace_seconds_per_km: null, avg_hr: null });
		expect(by_type.long).toEqual({ runs: 0, km: 0, avg_pace_seconds_per_km: null, avg_hr: null });
	});

	it('compares easy pace and HR across the first and second half of the window', async () => {
		await insertRun('2026-08-18', { distance_km: 6, duration_seconds: 2100, avg_hr: 150 }, 'easy');
		await insertRun('2026-10-06', { distance_km: 10, duration_seconds: 3000, avg_hr: 140 }, 'easy');
		await insertRun('2026-11-03', { distance_km: 5, duration_seconds: 1650, avg_hr: 150 }, 'easy');

		const { easy_pace_trend } = (await buildTrainingSummary(env.DB, TODAY)).run_fitness;

		expect(easy_pace_trend).toEqual({ first_seconds_per_km: 350, last_seconds_per_km: 310, first_avg_hr: 150, last_avg_hr: 145 });
	});

	it('leaves the easy trend null when one half has no easy runs', async () => {
		await insertRun('2026-10-06', { distance_km: 10, duration_seconds: 3000, avg_hr: 140 }, 'easy');

		const { easy_pace_trend } = (await buildTrainingSummary(env.DB, TODAY)).run_fitness;

		expect(easy_pace_trend).toEqual({ first_seconds_per_km: null, last_seconds_per_km: null, first_avg_hr: null, last_avg_hr: null });
	});

	it('picks the fastest run at or above each threshold', async () => {
		await insertRun('2026-08-18', { distance_km: 5.2, duration_seconds: 1600, avg_hr: 150 }, 'easy');
		await insertRun('2026-09-01', { distance_km: 5, duration_seconds: 1500, avg_hr: 160 }, 'intervals');
		await insertRun('2026-10-03', { distance_km: 10, duration_seconds: 3100, avg_hr: 155 }, 'tempo');
		await insertRun('2026-10-17', { distance_km: 21.1, duration_seconds: 7800, avg_hr: 165 }, 'long');
		// Fastest pace of all, but under 5 km, so it qualifies for no threshold.
		await insertRun('2026-11-01', { distance_km: 4, duration_seconds: 1100 }, 'easy');

		const { best_efforts } = (await buildTrainingSummary(env.DB, TODAY)).run_fitness;

		expect(best_efforts).toEqual([
			{ min_km: 5, date: '2026-09-01', distance_km: 5, duration_seconds: 1500, pace_seconds_per_km: 300, avg_hr: 160 },
			{ min_km: 10, date: '2026-10-03', distance_km: 10, duration_seconds: 3100, pace_seconds_per_km: 310, avg_hr: 155 },
			{ min_km: 15, date: '2026-10-17', distance_km: 21.1, duration_seconds: 7800, pace_seconds_per_km: 370, avg_hr: 165 },
			{ min_km: 21, date: '2026-10-17', distance_km: 21.1, duration_seconds: 7800, pace_seconds_per_km: 370, avg_hr: 165 },
		]);
	});

	it('estimates 10 km and half marathon times with Riegel from best efforts and recent races', async () => {
		// 5 km in 1500 s: 1500 x 2^1.06 = 3127.4 and 1500 x 4.22^1.06 = 6901.2.
		await insertRun('2026-09-01', { distance_km: 5, duration_seconds: 1500, avg_hr: 160 }, 'intervals');
		// A recent 5 km race in 1560 s: 3252.5 and 7177.2 before rounding.
		await insertRace('2026-10-01', 5, 1560);

		const { race_estimates } = (await buildTrainingSummary(env.DB, TODAY)).run_fitness;

		expect(race_estimates).toEqual([
			{ source: 'training_run', date: '2026-09-01', distance_km: 5, seconds: 1500, ten_k_seconds: 3127, half_marathon_seconds: 6901 },
			{ source: 'race', date: '2026-10-01', distance_km: 5, seconds: 1560, ten_k_seconds: 3252, half_marathon_seconds: 7177 },
		]);
	});

	it('excludes a race result older than 365 days, and goals without a result', async () => {
		await insertRace('2025-11-01', 21.1, 6000);
		await insertRace('2026-10-01', 5, 1560);
		await insertRace('2026-12-20', 21.1, null);

		const { race_estimates } = (await buildTrainingSummary(env.DB, TODAY)).run_fitness;

		expect(race_estimates.map((r) => [r.source, r.date])).toEqual([['race', '2026-10-01']]);
	});

	it('counts weeks with a run over 16 km and reports the longest run', async () => {
		await insertRun('2026-10-04', { distance_km: 17, duration_seconds: 6300 }, 'long');
		await insertRun('2026-10-06', { distance_km: 16, duration_seconds: 5900 }, 'easy');
		await insertRun('2026-11-02', { distance_km: 18, duration_seconds: 6900 }, 'long');

		const { longest_run_km, weeks_with_long_run_over_16km } = (await buildTrainingSummary(env.DB, TODAY)).run_fitness;

		// 16 km is not over 16: the weeks of 10-04 and 11-02 qualify, not 10-05.
		expect(weeks_with_long_run_over_16km).toBe(2);
		expect(longest_run_km).toBe(18);
	});

	it('ignores future runs and races', async () => {
		await insertRun('2026-11-20', { distance_km: 30, duration_seconds: 9000 }, 'easy');
		await insertRun('2026-11-16', { distance_km: 21.1, duration_seconds: 7000 }, 'long');
		await insertRace('2026-12-01', 21.1, 7000);

		const fitness = (await buildTrainingSummary(env.DB, TODAY)).run_fitness;

		expect(fitness.by_type.easy.runs).toBe(0);
		expect(fitness.by_type.long.runs).toBe(0);
		expect(fitness.best_efforts).toEqual([]);
		expect(fitness.race_estimates).toEqual([]);
		expect(fitness.longest_run_km).toBe(0);
		expect(fitness.weeks_with_long_run_over_16km).toBe(0);
	});
});
