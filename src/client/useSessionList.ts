import { useEffect, useState } from 'preact/hooks';
import type { SessionSummary } from '../types';
import { fetchSessions } from './api';

export interface UseSessionListResult {
	sessions: SessionSummary[] | undefined;
	error: string | null;
	setError: (error: string | null) => void;
	reload: () => void;
}

export interface SessionListParams {
	from?: string;
	to?: string;
	order?: 'asc' | 'desc';
	limit?: number;
}

/**
 * The fetch-a-list-of-sessions cycle shared by Today, Plan and History: those
 * three differ only in the date range they ask for, where a row links to, and
 * the error copy — not in how loading, cancellation or retry work.
 *
 * `sessions === undefined` means "still loading", distinct from `[]` which
 * means "loaded, genuinely nothing there" — the screens render those two very
 * differently and collapsing them would show "Nothing planned" during load.
 *
 * Params are destructured into the dependency array rather than passed as an
 * object, because a caller writing `useSessionList({ from: today })` builds a
 * new object literal every render — depending on that object identity would
 * refetch forever.
 */
export function useSessionList(params: SessionListParams, errorMessage: string): UseSessionListResult {
	const { from, to, order, limit } = params;
	const [sessions, setSessions] = useState<SessionSummary[] | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		fetchSessions({ from, to, order, limit })
			.then((result) => {
				if (cancelled) return;
				setSessions(result);
			})
			.catch(() => {
				if (cancelled) return;
				setError(errorMessage);
			});
		return () => {
			cancelled = true;
		};
	}, [from, to, order, limit, reloadToken]);

	return { sessions, error, setError, reload: () => setReloadToken((t) => t + 1) };
}
