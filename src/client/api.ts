import type { ApplySwapInput, LogRunInput, LogSetInput, PlannedSetStatus, SessionDetail, SessionStatus, SessionSummary, SwapCandidate } from '../types';
import { writeCachedSession } from './sessionCache';
import { enqueue } from './sync';

export async function fetchToday(): Promise<SessionDetail | null> {
	const res = await fetch('/api/sessions/today');
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
	const data = (await res.json()) as SessionDetail | { session: null };
	return data.session ? (data as SessionDetail) : null;
}

export async function fetchSession(sessionId: number): Promise<SessionDetail> {
	const res = await fetch(`/api/sessions/${sessionId}`);
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
	return res.json();
}

// Optimistic local update: applied and cached immediately, synced in the background.
export function logSet(sessionId: number, input: LogSetInput, detail: SessionDetail): SessionDetail {
	const plannedSets = detail.plannedSets.map((ps) => {
		if (ps.exercise_id !== input.exercise_id) return ps;
		const logged = ps.logged
			.filter((l) => l.set_index !== input.set_index)
			.concat({
				set_index: input.set_index,
				weight_kg: input.weight_kg,
				reps: input.reps,
				rir: input.rir,
				rest_taken_seconds: input.rest_taken_seconds,
				performed_on: input.performed_on,
			})
			.sort((a, b) => a.set_index - b.set_index);
		return { ...ps, logged };
	});

	const updated: SessionDetail = { ...detail, plannedSets };
	writeCachedSession(sessionId, updated);
	enqueue(`/api/sessions/${sessionId}/sets`, input, 'POST');
	return updated;
}

export function logRun(sessionId: number, input: LogRunInput, detail: SessionDetail): SessionDetail {
	const updated: SessionDetail = { ...detail, loggedRun: input };
	writeCachedSession(sessionId, updated);
	enqueue(`/api/sessions/${sessionId}/runs`, input, 'POST');
	return updated;
}

// Marks a session complete/skipped through the same offline-safe queue as
// every other write — no cached SessionDetail shape change is needed here
// beyond what the caller already holds.
export function setSessionStatus(sessionId: number, status: SessionStatus): void {
	enqueue(`/api/sessions/${sessionId}/status`, { status }, 'PATCH');
}

// Marks one exercise within a session planned/skipped — independent of the
// session-level status. Optimistically patches the local plannedSets array
// (same find-and-replace shape as logSet) so the accordion reflects the
// change immediately; the actual write goes through the same offline-safe
// queue as everything else.
export function setExerciseStatus(sessionId: number, plannedSetId: number, status: PlannedSetStatus, detail: SessionDetail): SessionDetail {
	const plannedSets = detail.plannedSets.map((ps) => (ps.id === plannedSetId ? { ...ps, status } : ps));
	const updated: SessionDetail = { ...detail, plannedSets };
	writeCachedSession(sessionId, updated);
	enqueue(`/api/sessions/${sessionId}/exercises/${plannedSetId}/status`, { status }, 'PATCH');
	return updated;
}

export async function fetchSessions(params: { from?: string; to?: string; order?: 'asc' | 'desc'; limit?: number } = {}): Promise<SessionSummary[]> {
	const qs = new URLSearchParams();
	if (params.from !== undefined) qs.set('from', params.from);
	if (params.to !== undefined) qs.set('to', params.to);
	if (params.order !== undefined) qs.set('order', params.order);
	if (params.limit !== undefined) qs.set('limit', String(params.limit));
	const query = qs.toString();

	const res = await fetch(`/api/sessions${query ? `?${query}` : ''}`);
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
	const data = (await res.json()) as { sessions: SessionSummary[] };
	return data.sessions;
}

export async function fetchSwapCandidates(exerciseId: number, pain: 'shoulder' | 'back' | null): Promise<SwapCandidate[]> {
	const qs = pain ? `?pain=${pain}` : '';
	const res = await fetch(`/api/swaps/candidates/${exerciseId}${qs}`);
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
	const data = (await res.json()) as { candidates: SwapCandidate[] };
	return data.candidates;
}

export async function applySwap(input: ApplySwapInput): Promise<void> {
	const res = await fetch('/api/swaps', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
}

// Moves a session to a different date — a planning-time action done at home,
// not mid-workout, so unlike logSet/setSessionStatus this is a direct
// awaited call rather than going through the offline sync queue.
export async function setSessionDate(sessionId: number, date: string): Promise<void> {
	const res = await fetch(`/api/sessions/${sessionId}/date`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ date }),
	});
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
}
