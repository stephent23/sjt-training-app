import type { PlannedSetDetail } from './types';

export interface SetDefaults {
	weight_kg: number;
	reps: number | null;
}

/**
 * Precedence, highest first:
 *  1. this set, already logged this session   → editing an existing entry, show what's there
 *  2. the previous set (setIndex - 1), logged this session → NEW: carry weight + reps forward,
 *     so confirming set 2 after set 1 needs zero typing if nothing changed
 *  3. the same set index, last time this exercise was logged (any prior session) → week-on-week continuity
 *  4. the prescription → target_weight_kg (or 0 for bodyweight/no target), reps null (no reps default from
 *     the prescription alone - only weight has a prescribed number, rep_low/rep_high is a RANGE not a single value)
 *
 * RIR is deliberately NOT part of this function and is never prefilled from the
 * plan or from last week — it's the single most important field in the schema
 * (drives every progression decision) and a stale default would get confirmed
 * without thought, quietly corrupting the signal. The first set of an exercise
 * always starts with RIR unset.
 *
 * Two things SetRow does that are not this function's business: it echoes back
 * a set's OWN already-logged rir so the chip you picked stays visible, and
 * (since 2026-11-15) it preselects the RIR of the set you logged a moment ago
 * for the next set of the same exercise, so sets 2+ are one tap. That is a
 * trade: fewer taps mid-workout against the risk of confirming the carried
 * value without thinking. If progression starts looking too generous, this
 * carry-over (SetRow's `defaultRir`) is the first thing to remove.
 */
export function resolveSetDefaults(planned: PlannedSetDetail, setIndex: number): SetDefaults {
	const isBodyweight = planned.loading === 'bodyweight';

	const thisSet = planned.logged.find((l) => l.set_index === setIndex);
	if (thisSet) {
		return { weight_kg: isBodyweight ? 0 : thisSet.weight_kg, reps: thisSet.reps };
	}

	const previousSet = planned.logged.find((l) => l.set_index === setIndex - 1);
	if (previousSet) {
		return { weight_kg: isBodyweight ? 0 : previousSet.weight_kg, reps: previousSet.reps };
	}

	const lastWeekSet = planned.lastWeek.find((l) => l.set_index === setIndex);
	if (lastWeekSet) {
		return { weight_kg: isBodyweight ? 0 : lastWeekSet.weight_kg, reps: lastWeekSet.reps };
	}

	return { weight_kg: isBodyweight ? 0 : (planned.target_weight_kg ?? 0), reps: null };
}
