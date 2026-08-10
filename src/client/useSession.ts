import { useEffect, useState } from 'preact/hooks';
import type { SessionDetail } from '../types';
import { fetchSession } from './api';
import { readCachedSession, writeCachedSession } from './sessionCache';
import { pendingCount } from './sync';

export interface UseSessionResult {
	detail: SessionDetail | null;
	error: string | null;
	setDetail: (detail: SessionDetail) => void;
	reload: () => void;
}

/**
 * Local writes still in flight own the *logging*; the server always owns the
 * *prescription*.
 *
 * This used to discard the whole server response whenever anything was queued
 * for the session, which meant a change made server-side mid-session never
 * appeared. Swapping an exercise is exactly that: the card kept the exercise it
 * was showing before, and with it that exercise's `loading` — so swapping a
 * bodyweight movement (pull-ups) for a loaded one (lat pulldown) left the row
 * saying "Bodyweight — no added load" with nowhere to enter a weight, until the
 * queue happened to drain.
 */
export function mergeUnsyncedLogs(fresh: SessionDetail, cached: SessionDetail | null): SessionDetail {
	if (!cached) return fresh;

	return {
		...fresh,
		plannedSets: fresh.plannedSets.map((plannedSet) => {
			const local = cached.plannedSets.find((c) => c.id === plannedSet.id);
			// Only while it's still the same exercise. After a swap those logged
			// sets belong to the exercise that was replaced, not to its substitute
			// — carrying them across would attribute one lift's numbers to another.
			if (!local || local.exercise_id !== plannedSet.exercise_id) return plannedSet;
			return { ...plannedSet, logged: local.logged };
		}),
		loggedRun: cached.loggedRun ?? fresh.loggedRun,
		feedback: cached.feedback ?? fresh.feedback,
	};
}

export function useSession(sessionId: number): UseSessionResult {
	const [detail, setDetailState] = useState<SessionDetail | null>(() => readCachedSession(sessionId));
	const [error, setError] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		fetchSession(sessionId)
			.then((fresh) => {
				if (cancelled) return;
				const hasPendingWrites = pendingCount(`/api/sessions/${sessionId}/`) > 0;
				setDetailState((current) => {
					const next = hasPendingWrites ? mergeUnsyncedLogs(fresh, current) : fresh;
					writeCachedSession(sessionId, next);
					return next;
				});
				setError(null);
			})
			.catch(() => {
				if (cancelled) return;
				// Cold cache + failed fetch = genuinely nothing to show.
				// Warm cache + failed fetch = keep showing the cached copy, just flag it.
				setError(detail === null ? 'Could not load this session.' : 'Showing the last saved copy — could not refresh.');
			});
		return () => {
			cancelled = true;
		};
	}, [sessionId, reloadToken]);

	function setDetail(next: SessionDetail) {
		setDetailState(next);
		writeCachedSession(sessionId, next);
	}

	function reload() {
		setReloadToken((t) => t + 1);
	}

	return { detail, error, setDetail, reload };
}
