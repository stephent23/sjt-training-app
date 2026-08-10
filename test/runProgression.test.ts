import { describe, expect, it } from 'vitest';
import { MAX_WEEKLY_RUN_GROWTH, progressRun } from '../src/runProgression';
import type { LoggedRunForProgression } from '../src/runProgression';

function loggedRun(overrides: Partial<LoggedRunForProgression> = {}): LoggedRunForProgression {
	return { distance_km: 6.2, duration_seconds: 2100, rpe_1_10: 5, ...overrides };
}

describe('progressRun', () => {
	it('grows the long run by exactly the 10% cap, rounded to 1 decimal', () => {
		expect(MAX_WEEKLY_RUN_GROWTH).toBe(0.1);
		// 6.2 * 1.1 = 6.820000000000001 in floating point — must round cleanly to 6.8.
		const result = progressRun('long', 6.2, loggedRun({ distance_km: 6.2 }));
		expect(result.action).toBe('increase_long_run');
		expect(result.next_target_km).toBe(6.8);
		expect(result.reason).toMatch(/10%/);
	});

	it('holds easy runs — they stay easy regardless of what was logged', () => {
		const result = progressRun('easy', 5, loggedRun({ distance_km: 5.5 }));
		expect(result.action).toBe('hold_easy');
		expect(result.next_target_km).toBe(5);
		expect(result.reason).toBe('Easy runs stay easy.');
	});

	it('holds quality sessions (tempo)', () => {
		const result = progressRun('tempo', 6, loggedRun());
		expect(result.action).toBe('hold_quality');
		expect(result.next_target_km).toBe(6);
	});

	it('holds quality sessions (intervals)', () => {
		const result = progressRun('intervals', null, loggedRun());
		expect(result.action).toBe('hold_quality');
		expect(result.next_target_km).toBeNull();
	});

	it('holds the long run when nothing was logged to grow from', () => {
		const result = progressRun('long', 9, null);
		expect(result.action).toBe('hold_long_run');
		expect(result.next_target_km).toBe(9);
		expect(result.reason).toMatch(/No logged long run/);
	});

	it('holds the long run when no prior target existed, even if something was logged', () => {
		const result = progressRun('long', null, loggedRun({ distance_km: 8 }));
		expect(result.action).toBe('hold_long_run');
		expect(result.next_target_km).toBeNull();
	});
});

// Growth used to depend only on whether a long run existed at all. A run cut
// half short, or one that took everything you had, earned the same 10% as a
// comfortable one — so the plan kept climbing away from what was survivable.
describe('progressRun — what the run actually cost', () => {
	it('holds when the last long run came up well short of its target', () => {
		const result = progressRun('long', 10, loggedRun({ distance_km: 7 }));
		expect(result.action).toBe('hold_long_run');
		expect(result.next_target_km).toBe(10);
		expect(result.reason).toMatch(/short of the 10km/);
	});

	it('still grows when the run was only marginally short', () => {
		// 9.3 of 10 is a route that measured a bit differently, not a bad run.
		expect(progressRun('long', 10, loggedRun({ distance_km: 9.3 })).action).toBe('increase_long_run');
	});

	it('holds when the run was logged as very hard', () => {
		const result = progressRun('long', 10, loggedRun({ distance_km: 10, rpe_1_10: 9 }));
		expect(result.action).toBe('hold_long_run');
		expect(result.reason).toMatch(/RPE 9/);
	});

	it('holds when heart rate says it was hard even if the RPE was generous', () => {
		const result = progressRun('long', 10, loggedRun({ distance_km: 10, rpe_1_10: 4, avg_hr: 180, max_hr: 185 }));
		expect(result.action).toBe('hold_long_run');
		expect(result.reason).toMatch(/heart rate/);
	});

	it('grows on a run that was long enough and comfortable enough', () => {
		const result = progressRun('long', 10, loggedRun({ distance_km: 10, rpe_1_10: 5, avg_hr: 145, max_hr: 165 }));
		expect(result.action).toBe('increase_long_run');
		expect(result.next_target_km).toBe(11);
	});

	it('grows when the effort fields are absent — absence is not evidence of strain', () => {
		const result = progressRun('long', 10, loggedRun({ distance_km: 10, rpe_1_10: null, avg_hr: null, max_hr: null }));
		expect(result.action).toBe('increase_long_run');
	});
});
