// How much of a session is actually done. Pure — no DB, no DOM — so the
// "is this finished?" question has exactly one answer shared by the lift
// screen and the review screen, rather than two reduce() expressions that
// drift apart.

import type { PlannedSetDetail } from './types';

function isActive(ps: PlannedSetDetail): boolean {
	return ps.status !== 'skipped';
}

/**
 * How many of an exercise's prescribed sets have been logged.
 *
 * Counts matching set INDEXES within 1..target_sets rather than taking
 * `logged.length`. Two cases where that differs and length is wrong: a
 * gap (`[set 1, set 3]` against 3 targets is 2 done, not "nearly 3"), and an
 * over-log (4 rows against a target later reduced to 3 would read "4 of 3").
 */
export function loggedSetCount(ps: PlannedSetDetail): number {
	let count = 0;
	for (let setIndex = 1; setIndex <= ps.target_sets; setIndex++) {
		if (ps.logged.some((l) => l.set_index === setIndex)) count++;
	}
	return count;
}

export function isExerciseLogged(ps: PlannedSetDetail): boolean {
	return loggedSetCount(ps) >= ps.target_sets;
}

/** Set totals for a session, counting only what you still intend to do. */
export function sessionSetTotals(plannedSets: PlannedSetDetail[]): { target: number; logged: number } {
	const active = plannedSets.filter(isActive);
	return {
		target: active.reduce((sum, ps) => sum + ps.target_sets, 0),
		logged: active.reduce((sum, ps) => sum + loggedSetCount(ps), 0),
	};
}

/**
 * True once every exercise you didn't skip has all its sets logged.
 *
 * Deliberately false when there are no non-skipped exercises at all: `[].every()`
 * is true, and a session where everything was skipped must not present "Mark
 * complete" as the obvious action — that's a skipped session, not a finished one.
 */
export function isSessionComplete(plannedSets: PlannedSetDetail[]): boolean {
	const active = plannedSets.filter(isActive);
	return active.length > 0 && active.every(isExerciseLogged);
}
