import type {
	ApplySwapInput,
	Exercise,
	Modality,
	LogRunInput,
	LogSetInput,
	ManualRunInput,
	PlannedSetStatus,
	SessionDetail,
	SessionFeedback,
	SessionStatus,
	SessionSummary,
	Settings,
	SwapCandidate,
	MultiWeekProposal,
	MultiWeekProposalInput,
} from '../types';
import { writeCachedSession } from './sessionCache';
import { enqueue } from './sync';

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

// Same optimistic + queued shape as logSet/logRun. The route upserts on
// session_id, so a retry can never create a second feedback row.
export function saveFeedback(sessionId: number, feedback: SessionFeedback, detail: SessionDetail): SessionDetail {
	const updated: SessionDetail = { ...detail, feedback };
	writeCachedSession(sessionId, updated);
	enqueue(`/api/sessions/${sessionId}/feedback`, feedback, 'PUT');
	return updated;
}

export async function fetchSessions(
	params: { from?: string; to?: string; order?: 'asc' | 'desc'; limit?: number } = {},
): Promise<SessionSummary[]> {
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

/** Non-ok responses carry a reason worth showing — a 409 here means the
 * substitute is already in this session, which the person can act on. */
async function errorFrom(res: Response): Promise<Error> {
	const body = (await res.json().catch(() => null)) as { error?: string } | null;
	return new Error(body?.error ?? `request failed: ${res.status}`);
}

export async function applySwap(input: ApplySwapInput): Promise<void> {
	const res = await fetch('/api/swaps', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
	if (!res.ok) throw await errorFrom(res);
}

export async function fetchPatterns(): Promise<string[]> {
	const res = await fetch('/api/exercises/patterns');
	if (!res.ok) throw await errorFrom(res);
	return ((await res.json()) as { patterns: string[] }).patterns;
}

export async function createExercise(input: {
	name: string;
	pattern: string;
	increment_kg: number;
	modality: Modality;
}): Promise<Exercise> {
	const res = await fetch('/api/exercises', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
	if (!res.ok) throw await errorFrom(res);
	return ((await res.json()) as { exercise: Exercise }).exercise;
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

// A run recorded (or corrected) by hand at a keyboard, not mid-workout —
// direct awaited fetches like setSessionDate above, not the offline sync
// queue that logSet/logRun use for a live session.
export async function createManualRun(input: ManualRunInput): Promise<{ id: number }> {
	const res = await fetch('/api/runs', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
	if (!res.ok) throw await errorFrom(res);
	return res.json();
}

export async function updateManualRun(sessionId: number, input: ManualRunInput): Promise<void> {
	const res = await fetch(`/api/runs/${sessionId}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
	if (!res.ok) throw await errorFrom(res);
}

export async function deleteManualRun(sessionId: number): Promise<void> {
	const res = await fetch(`/api/runs/${sessionId}`, { method: 'DELETE' });
	if (!res.ok) throw await errorFrom(res);
}

export async function fetchSettings(): Promise<Settings> {
	const res = await fetch('/api/settings');
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
	return res.json();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
	const res = await fetch('/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch),
	});
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
}

// A plain `<a href="/api/generator/export" download>` produced an empty file:
// the app runs as an installed standalone PWA (manifest display: standalone),
// where handing a same-origin navigation off to the browser's download manager
// is unreliable, and a failed export gave no feedback at all. Fetching the
// bytes ourselves and saving them from a blob keeps the download inside the
// page, and lets a non-ok response surface as an error instead of a 0-byte
// file.
/** The export as raw text. Shared by the download and the copy-it-all-as-one-
 * paste button, so the two can't diverge — and the text is passed through
 * unmodified, never re-serialised. */
export async function fetchExportText(weeks: number): Promise<string> {
	const res = await fetch(`/api/generator/export?weeks=${weeks}`);
	if (!res.ok) throw await errorFrom(res);

	const text = await res.text();
	if (text.trim() === '') throw new Error('the export came back empty');
	return text;
}

export async function downloadExport(weeks: number, filename = 'training-export.json'): Promise<void> {
	const text = await fetchExportText(weeks);

	const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
	try {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		URL.revokeObjectURL(url);
	}
}

export interface PendingProposal {
	id: number;
	first_week_number: number;
	week_count: number;
	created_at: string;
	plan: MultiWeekProposal;
}

export async function fetchPendingProposal(): Promise<PendingProposal | null> {
	const res = await fetch('/api/generator/pending');
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
	const data = (await res.json()) as { pending: PendingProposal | null };
	return data.pending;
}

/** A 422 from import carries the exact validation problems (bad exercise_id,
 * weight jump too big, session count, ...) — the things the person has to hand
 * back to their assistant to get a corrected plan. Carried as a list so the UI
 * never has to split a joined string back apart. */
export class ImportRejected extends Error {
	constructor(readonly errors: string[]) {
		super(errors.join('; '));
		this.name = 'ImportRejected';
	}
}

export async function importProposal(input: MultiWeekProposalInput, replace = false): Promise<{ id: number }> {
	const res = await fetch(`/api/generator/import${replace ? '?replace=true' : ''}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(input),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => null)) as { error?: string; errors?: string[] } | null;
		throw new ImportRejected(body?.errors ?? [body?.error ?? `request failed: ${res.status}`]);
	}
	return res.json();
}

export async function acceptProposal(id: number): Promise<void> {
	const res = await fetch(`/api/generator/${id}/accept`, { method: 'POST' });
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
}

export async function rejectProposal(id: number): Promise<void> {
	const res = await fetch(`/api/generator/${id}/reject`, { method: 'POST' });
	if (!res.ok) throw new Error(`request failed: ${res.status}`);
}
