import { useEffect, useState } from 'preact/hooks';
import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { fetchSessions, setSessionDate } from '../api';
import { SessionList } from '../components/SessionRow';

// Completed sessions should be reviewed, not re-logged — even on the Plan
// screen, which otherwise links into live logging.
function linkFor(s: SessionSummary): string {
	if (s.status === 'completed') return `#/review/${s.id}`;
	return `#/${s.kind}/${s.id}`;
}

export function Plan() {
	const [sessions, setSessions] = useState<SessionSummary[] | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		fetchSessions({ from: todayIso(), order: 'asc' })
			.then((result) => {
				if (cancelled) return;
				setSessions(result);
			})
			.catch(() => {
				if (cancelled) return;
				setError('Could not load the plan.');
			});
		return () => {
			cancelled = true;
		};
	}, [retryToken]);

	if (error) {
		return (
			<main class="screen">
				<h1>Plan</h1>
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
				<h1>Plan</h1>
				<p>Loading…</p>
			</main>
		);
	}

	async function handleReschedule(session: SessionSummary, date: string) {
		// Refetch afterward rather than re-sorting locally — moving a date can
		// change both sort order and which week a session groups under, and
		// getting that right server-side (already sorted/filtered by the same
		// query Plan always uses) is simpler than duplicating that logic here.
		try {
			await setSessionDate(session.id, date);
			setRetryToken((t) => t + 1);
		} catch {
			setError('Could not move that session — try again.');
		}
	}

	return (
		<main class="screen">
			<h1>Plan</h1>
			<SessionList sessions={sessions} linkFor={linkFor} emptyMessage="Nothing planned." onReschedule={handleReschedule} />
		</main>
	);
}
