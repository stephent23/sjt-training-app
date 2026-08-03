import type { Exercise, SwapCandidate } from './types';

export type PainType = 'shoulder' | 'back' | null;

/**
 * Candidates for replacing `from`: same movement pattern, no spotter needed,
 * and — when a pain flag is in play — restricted to the joint-safe subset.
 * Ranked by default status first, then by whether there's logged history.
 * No DB access here: the caller fetches exercises and history, this just ranks them.
 */
export function rankSwapCandidates(exercises: Exercise[], from: Exercise, painType: PainType, history: Set<number>): SwapCandidate[] {
	return exercises
		.filter((e) => e.id !== from.id)
		.filter((e) => e.pattern === from.pattern)
		.filter((e) => e.needs_spotter === 0)
		.filter((e) => (painType === 'shoulder' ? e.shoulder_safe === 1 : true))
		.filter((e) => (painType === 'back' ? e.back_safe === 1 : true))
		.map((e) => ({ ...e, hasHistory: history.has(e.id) }))
		.sort((a, b) => {
			if (a.is_default !== b.is_default) return b.is_default - a.is_default;
			if (a.hasHistory !== b.hasHistory) return a.hasHistory ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
}
