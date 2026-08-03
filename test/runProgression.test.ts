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
