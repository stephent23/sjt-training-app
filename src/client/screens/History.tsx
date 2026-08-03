import { useEffect, useState } from 'preact/hooks';
import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { fetchSessions } from '../api';
import { SessionList } from '../components/SessionRow';

// History is for reviewing what happened, not for logging — every row goes
// to Review, even if a past session was never marked complete.
function linkFor(s: SessionSummary): string {
	return `#/review/${s.id}`;
}

export function History() {
	const [sessions, setSessions] = useState<SessionSummary[] | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		fetchSessions({ to: todayIso(), order: 'desc' })
			.then((result) => {
				if (cancelled) return;
				setSessions(result);
			})
			.catch(() => {
				if (cancelled) return;
				setError('Could not load history.');
			});
		return () => {
			cancelled = true;
		};
	}, [retryToken]);

	if (error) {
		return (
			<main class="screen">
				<h1>History</h1>
				<p>{error}</p>
				<button type="button" class="btn-secondary" onClick={() => setRetryToken((t) => t + 1)}>
					Retry
				</button>
			</main>
		);
	}

	if (sessions === undefined) {
		return (
			<main class="screen">
				<h1>History</h1>
				<p>Loading…</p>
			</main>
		);
	}

	return (
		<main class="screen">
			<h1>History</h1>
			<SessionList sessions={sessions} linkFor={linkFor} emptyMessage="Nothing logged yet." />
		</main>
	);
}
