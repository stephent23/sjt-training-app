import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildTrainingSummary, type WeekSummary } from '../src/trainingSummary';
import { insertExercise, insertLoggedRun, insertLoggedSet, insertSession } from './fixtures';

// 2026-11-15 is a Sunday, so the current week is Mon 2026-11-09 .. Sun 11-15
// and the default 12-week window starts Mon 2026-08-17.
const TODAY = '2026-11-15';
const CURRENT_WEEK = '2026-11-09';

function week(summary: { weeks: WeekSummary[] }, weekStart: string): WeekSummary {
	const found = summary.weeks.find((w) => w.week_start === weekStart);
	if (!found) throw new Error(`no bucket for ${weekStart}`);
	return found;
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
