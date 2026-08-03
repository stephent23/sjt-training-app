import { describe, expect, it } from 'vitest';
import { resolveSetDefaults, type SetDefaults } from '../src/setDefaults';
import type { LoggedSetEntry, PlannedSetDetail } from '../src/types';

function loggedEntry(overrides: Partial<LoggedSetEntry> = {}): LoggedSetEntry {
	return {
		set_index: 1,
		weight_kg: 20,
		reps: 8,
		rir: 2,
		rest_taken_seconds: 120,
		performed_on: '2026-07-27',
		...overrides,
	};
}

function planned(overrides: Partial<PlannedSetDetail> = {}): PlannedSetDetail {
	return {
		id: 1,
		exercise_id: 1,
		exercise_name: 'Test Exercise',
		pattern: 'horizontal_push',
		loading: 'per_hand',
		increment_kg: 2,
		order_index: 1,
		target_sets: 3,
		rep_low: 8,
		rep_high: 10,
		target_weight_kg: null,
		rest_seconds: 120,
		notes: null,
		lastWeek: [],
		logged: [],
		...overrides,
	};
}

describe('resolveSetDefaults', () => {
	it('returns exactly what is logged when this set index is already logged this session', () => {
		const p = planned({
			logged: [loggedEntry({ set_index: 2, weight_kg: 30, reps: 9 })],
			lastWeek: [loggedEntry({ set_index: 2, weight_kg: 99, reps: 99 })],
			target_weight_kg: 50,
		});
		expect(resolveSetDefaults(p, 2)).toEqual<SetDefaults>({ weight_kg: 30, reps: 9 });
	});

	it('carries weight + reps forward from the previous set logged this session (new pre-populate behaviour)', () => {
		// Set 1 has just been confirmed this session; set 2 has nothing logged yet.
		// Confirming set 2 should require zero typing — it should default to exactly
		// what was just logged for set 1, not last week's numbers.
		const p = planned({
			logged: [loggedEntry({ set_index: 1, weight_kg: 22.5, reps: 7 })],
			lastWeek: [loggedEntry({ set_index: 2, weight_kg: 20, reps: 8 })],
			target_weight_kg: 20,
		});
		expect(resolveSetDefaults(p, 2)).toEqual<SetDefaults>({ weight_kg: 22.5, reps: 7 });
	});

	it('falls back to lastWeek at the same set index when nothing is logged this session', () => {
		const p = planned({
			logged: [],
			lastWeek: [loggedEntry({ set_index: 3, weight_kg: 27.5, reps: 6 })],
			target_weight_kg: 25,
		});
		expect(resolveSetDefaults(p, 3)).toEqual<SetDefaults>({ weight_kg: 27.5, reps: 6 });
	});

	it('falls back to target_weight_kg with null reps when nothing is logged anywhere', () => {
		const p = planned({ logged: [], lastWeek: [], target_weight_kg: 40 });
		expect(resolveSetDefaults(p, 1)).toEqual<SetDefaults>({ weight_kg: 40, reps: null });
	});

	it('falls back to 0 weight with null reps when target_weight_kg is null', () => {
		const p = planned({ logged: [], lastWeek: [], target_weight_kg: null });
		expect(resolveSetDefaults(p, 1)).toEqual<SetDefaults>({ weight_kg: 0, reps: null });
	});

	it('always resolves weight to 0 for bodyweight exercises, even if logged/lastWeek/target have a weight', () => {
		const p = planned({
			loading: 'bodyweight',
			logged: [loggedEntry({ set_index: 1, weight_kg: 15, reps: 10 })],
			target_weight_kg: 99,
		});
		expect(resolveSetDefaults(p, 1)).toEqual<SetDefaults>({ weight_kg: 0, reps: 10 });
	});

	it('bodyweight also zeroes weight on the previous-set-carry-forward path', () => {
		const p = planned({
			loading: 'bodyweight',
			logged: [loggedEntry({ set_index: 1, weight_kg: 15, reps: 10 })],
		});
		expect(resolveSetDefaults(p, 2)).toEqual<SetDefaults>({ weight_kg: 0, reps: 10 });
	});

	it('bodyweight also zeroes weight on the lastWeek fallback path', () => {
		const p = planned({
			loading: 'bodyweight',
			lastWeek: [loggedEntry({ set_index: 1, weight_kg: 15, reps: 10 })],
		});
		expect(resolveSetDefaults(p, 1)).toEqual<SetDefaults>({ weight_kg: 0, reps: 10 });
	});

	it('bodyweight falls back to 0 weight from the prescription too', () => {
		const p = planned({ loading: 'bodyweight', target_weight_kg: 99 });
		expect(resolveSetDefaults(p, 1)).toEqual<SetDefaults>({ weight_kg: 0, reps: null });
	});

	it('never includes an rir field on the returned defaults', () => {
		const p = planned({ logged: [loggedEntry({ set_index: 1, weight_kg: 20, reps: 8, rir: 3 })] });
		const result = resolveSetDefaults(p, 1);
		expect(Object.keys(result).sort()).toEqual(['reps', 'weight_kg']);
		expect('rir' in result).toBe(false);
	});
});
