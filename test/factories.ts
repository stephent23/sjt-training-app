// Pure in-memory object factories for the shared types.
//
// Kept separate from test/fixtures.ts, which inserts rows into a real D1 via
// `cloudflare:test` — that import only resolves inside the "worker" vitest
// project, so client (jsdom) tests can't touch it. These have no imports
// beyond types, so both projects can use them.

import type { LoggedSetEntry, PlannedSetDetail } from '../src/types';

export function loggedEntry(overrides: Partial<LoggedSetEntry> = {}): LoggedSetEntry {
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

export function plannedSet(overrides: Partial<PlannedSetDetail> = {}): PlannedSetDetail {
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
		status: 'planned',
		superset_group: null,
		lastWeek: [],
		logged: [],
		...overrides,
	};
}

/** Shorthand for "this exercise has sets 1..n logged". */
export function loggedSets(count: number, overrides: Partial<LoggedSetEntry> = {}): LoggedSetEntry[] {
	return Array.from({ length: count }, (_, i) => loggedEntry({ set_index: i + 1, ...overrides }));
}
