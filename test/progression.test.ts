import { describe, expect, it } from 'vitest';
import { progressExercise } from '../src/progression';
import type { ExercisePrescription, LoggedSetForProgression } from '../src/progression';

function prescription(overrides: Partial<ExercisePrescription> = {}): ExercisePrescription {
	return { rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120, increment_kg: 2, ...overrides };
}

function set(overrides: Partial<LoggedSetForProgression> = {}): LoggedSetForProgression {
	return { weight_kg: 20, reps: 10, rir: 2, rest_taken_seconds: 130, ...overrides };
}

describe('progressExercise', () => {
	it('increases weight and resets reps when all sets hit the top of the range at low RIR', () => {
		const result = progressExercise(prescription(), [set({ reps: 10, rir: 0 }), set({ reps: 10, rir: 1 }), set({ reps: 10, rir: 1 })]);
		expect(result.action).toBe('increase_weight_reset_reps');
		expect(result.next_weight_kg).toBe(22);
		expect(result.reason).toMatch(/weight increase earned/);
	});

	it('double-increases weight when all sets hit the top of the range with reps in reserve (high RIR)', () => {
		const result = progressExercise(prescription(), [set({ reps: 10, rir: 3 }), set({ reps: 10, rir: 2 }), set({ reps: 10, rir: 2 })]);
		expect(result.action).toBe('double_increase_weight');
		expect(result.next_weight_kg).toBe(24);
		expect(result.reason).toMatch(/too light/);
	});

	it('holds weight and calls for one more rep when reps land in range without maxing out', () => {
		const result = progressExercise(prescription(), [set({ reps: 9, rir: 2 }), set({ reps: 8, rir: 2 }), set({ reps: 8, rir: 1 })]);
		expect(result.action).toBe('increase_reps');
		expect(result.next_weight_kg).toBe(20);
		expect(result.reason).toMatch(/hold weight, aim for one more rep/);
	});

	it('holds when reps fall below the low end of the range', () => {
		const result = progressExercise(prescription(), [set({ reps: 6, rir: 1, rest_taken_seconds: 130 })]);
		expect(result.action).toBe('hold');
		expect(result.next_weight_kg).toBe(20);
		expect(result.restWasShort).toBe(false);
		expect(result.reason).toMatch(/hold and repeat the week/);
	});

	it('holds and flags restWasShort when reps also fell below range and rest ran under prescription', () => {
		const result = progressExercise(prescription({ rest_seconds: 120 }), [set({ reps: 6, rir: 1, rest_taken_seconds: 90 })]);
		expect(result.action).toBe('hold');
		expect(result.restWasShort).toBe(true);
		expect(result.reason).toMatch(/rest ran under the prescribed 120s/);
	});

	it('holds with no logged sets rather than guessing', () => {
		const result = progressExercise(prescription({ target_weight_kg: 20 }), []);
		expect(result.action).toBe('hold');
		expect(result.next_weight_kg).toBe(20);
		expect(result.restWasShort).toBe(false);
		expect(result.reason).toMatch(/No sets logged/);
	});

	it('falls back to the median logged weight as the baseline when target_weight_kg is null (calibration week)', () => {
		const result = progressExercise(prescription({ target_weight_kg: null }), [
			set({ weight_kg: 18, reps: 9, rir: 2 }),
			set({ weight_kg: 20, reps: 8, rir: 2 }),
			set({ weight_kg: 22, reps: 8, rir: 1 }),
		]);
		// median of [18, 20, 22] is 20; reps landed in range without maxing out -> hold weight, increase_reps
		expect(result.action).toBe('increase_reps');
		expect(result.next_weight_kg).toBe(20);
	});
});
