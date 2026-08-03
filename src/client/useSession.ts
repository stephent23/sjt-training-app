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

export function useSession(sessionId: number): UseSessionResult {
	const [detail, setDetailState] = useState<SessionDetail | null>(() => readCachedSession(sessionId));
	const [error, setError] = useState<string | null>(null);
	const [reloadToken, setReloadToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		fetchSession(sessionId)
			.then((fresh) => {
				if (cancelled) return;
				// Unsynced local writes for THIS session still in flight — trust the
				// local copy over a server response that predates them.
				if (pendingCount(`/api/sessions/${sessionId}/`) > 0) return;
				setDetailState(fresh);
				writeCachedSession(sessionId, fresh);
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
