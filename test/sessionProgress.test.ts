import { describe, expect, it } from 'vitest';
import { isExerciseLogged, isSessionComplete, loggedSetCount, sessionSetTotals } from '../src/sessionProgress';
import { loggedEntry, loggedSets, plannedSet } from './factories';

describe('loggedSetCount', () => {
	it('counts logged sets against the prescription', () => {
		expect(loggedSetCount(plannedSet({ target_sets: 3, logged: loggedSets(2) }))).toBe(2);
	});

	// `logged.length` would say 2 here and imply you were nearly done.
	it('ignores a gap — sets 1 and 3 of 3 is two done, not "up to set 3"', () => {
		const ps = plannedSet({ target_sets: 3, logged: [loggedEntry({ set_index: 1 }), loggedEntry({ set_index: 3 })] });

		expect(loggedSetCount(ps)).toBe(2);
		expect(isExerciseLogged(ps)).toBe(false);
	});

	// `logged.length` would read "4 of 3 logged".
	it('caps at target_sets when more sets were logged than prescribed', () => {
		expect(loggedSetCount(plannedSet({ target_sets: 3, logged: loggedSets(4) }))).toBe(3);
	});

	it('is zero for an untouched exercise', () => {
		expect(loggedSetCount(plannedSet({ target_sets: 3 }))).toBe(0);
	});
});

describe('sessionSetTotals', () => {
	it('sums targets and logged sets across exercises', () => {
		const totals = sessionSetTotals([
			plannedSet({ id: 1, target_sets: 4, logged: loggedSets(4) }),
			plannedSet({ id: 2, target_sets: 3, logged: loggedSets(1) }),
		]);

		expect(totals).toEqual({ target: 7, logged: 5 });
	});

	// Wednesday's real session: 26 logged, three exercises skipped. It should
	// read "26 of 26", not "26 of 35".
	it('excludes skipped exercises from both the target and the logged count', () => {
		const totals = sessionSetTotals([
			plannedSet({ id: 1, target_sets: 3, logged: loggedSets(3) }),
			plannedSet({ id: 2, target_sets: 3, status: 'skipped' }),
			plannedSet({ id: 3, target_sets: 3, status: 'skipped', logged: loggedSets(1) }),
		]);

		expect(totals).toEqual({ target: 3, logged: 3 });
	});

	it('is zero/zero for an empty session', () => {
		expect(sessionSetTotals([])).toEqual({ target: 0, logged: 0 });
	});
});

describe('isSessionComplete', () => {
	it('is false while any prescribed set is outstanding', () => {
		expect(isSessionComplete([plannedSet({ target_sets: 3, logged: loggedSets(2) })])).toBe(false);
	});

	it('is true once every exercise is fully logged', () => {
		expect(
			isSessionComplete([
				plannedSet({ id: 1, target_sets: 3, logged: loggedSets(3) }),
				plannedSet({ id: 2, target_sets: 2, logged: loggedSets(2) }),
			]),
		).toBe(true);
	});

	// The headline case: this is why Wednesday's session stayed on "planned".
	it('is true when the only unfinished exercises were skipped', () => {
		expect(
			isSessionComplete([
				plannedSet({ id: 1, target_sets: 3, logged: loggedSets(3) }),
				plannedSet({ id: 2, target_sets: 3, status: 'skipped' }),
			]),
		).toBe(true);
	});

	// [].every() is true, so this needs an explicit guard — a session where you
	// skipped everything is a skipped session, not a completed one.
	it('is false when every exercise was skipped', () => {
		expect(
			isSessionComplete([plannedSet({ id: 1, status: 'skipped' }), plannedSet({ id: 2, status: 'skipped' })]),
		).toBe(false);
	});

	it('is false for a session with no exercises at all', () => {
		expect(isSessionComplete([])).toBe(false);
	});
});
