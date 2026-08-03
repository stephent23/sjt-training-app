import type { ApplySwapInput, LogRunInput, LogSetInput, SessionDetail, SwapCandidate } from '../types';
import { writeCachedSession } from './sessionCache';
import { enqueue } from './sync';

export async function fetchToday(): Promise<SessionDetail | null> {
	const res = await fetch('/api/sessions/today');
	const data = (await res.json()) as SessionDetail | { session: null };
	return data.session ? (data as SessionDetail) : null;
}

export async function fetchSession(sessionId: number): Promise<SessionDetail> {
	const res = await fetch(`/api/sessions/${sessionId}`);
	return res.json();
}

// Optimistic local update: applied and cached immediately, synced in the background.
export function logSet(sessionId: number, input: LogSetInput, detail: SessionDetail): SessionDetail {
	const plannedSets = detail.plannedSets.map((ps) => {
		if (ps.exercise_id !== input.exercise_id) return ps;
		const logged = ps.logged
			.filter((l) => l.set_index !== input.set_index)
			.concat({ set_index: input.set_index, weight_kg: input.weight_kg, reps: input.reps, rir: input.rir, rest_taken_seconds: input.rest_taken_seconds })
			.sort((a, b) => a.set_index - b.set_index);
		return { ...ps, logged };
	});

	const updated: SessionDetail = { ...detail, plannedSets };
	writeCachedSession(sessionId, updated);
	enqueue(`/api/sessions/${sessionId}/sets`, input);
	return updated;
}

export function logRun(sessionId: number, input: LogRunInput, detail: SessionDetail): SessionDetail {
	const updated: SessionDetail = { ...detail, loggedRun: input };
	writeCachedSession(sessionId, updated);
	enqueue(`/api/sessions/${sessionId}/runs`, input);
	return updated;
}

export async function fetchSwapCandidates(exerciseId: number, pain: 'shoulder' | 'back' | null): Promise<SwapCandidate[]> {
	const qs = pain ? `?pain=${pain}` : '';
	const res = await fetch(`/api/swaps/candidates/${exerciseId}${qs}`);
	const data = (await res.json()) as { candidates: SwapCandidate[] };
	return data.candidates;
}

export async function applySwap(input: ApplySwapInput): Promise<void> {
	await fetch('/api/swaps', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
}
