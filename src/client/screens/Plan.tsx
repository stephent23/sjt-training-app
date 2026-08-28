import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { setSessionDate } from '../api';
import { SessionList } from '../components/SessionRow';
import { useSessionList } from '../useSessionList';

// Plan is a preview of what's coming, not a place to log from — a planned
// session here is read-only (#/preview/:id). Logging happens on the day
// itself, via Today. Completed/skipped sessions go to Review, same as
// everywhere else that links to a resolved session.
function linkFor(s: SessionSummary): string {
	if (s.status === 'planned') return `#/preview/${s.id}`;
	return `#/review/${s.id}`;
}

export function Plan() {
	const { sessions, error, setError, reload } = useSessionList({ from: todayIso(), order: 'asc' }, 'Could not load the plan.');

	async function handleReschedule(session: SessionSummary, date: string) {
		// Refetch afterward rather than re-sorting locally — moving a date can
		// change both sort order and which week a session groups under, and
		// getting that right server-side (already sorted/filtered by the same
		// query Plan always uses) is simpler than duplicating that logic here.
		try {
			await setSessionDate(session.id, date);
			reload();
		} catch {
			setError('Could not move that session — try again.');
		}
	}

	return (
		<main class="screen">
			<h1>Plan</h1>
			{error ? (
				<>
					<p>{error}</p>
					<button type="button" class="btn-secondary" onClick={reload}>
						Retry
					</button>
				</>
			) : sessions === undefined ? (
				<p>Loading…</p>
			) : (
				// A completed session isn't "coming" anymore, so it drops off Plan
				// entirely — it's still fully visible on History. A skipped one
				// stays, since it may still need rescheduling.
				<SessionList
					sessions={sessions.filter((s) => s.status !== 'completed')}
					linkFor={linkFor}
					emptyMessage="Nothing planned."
					onReschedule={handleReschedule}
					collapsible
				/>
			)}
		</main>
	);
}
