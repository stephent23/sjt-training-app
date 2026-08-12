import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { SessionList } from '../components/SessionRow';
import { useSessionList } from '../useSessionList';

// History is for reviewing what happened, not for logging — every row goes
// to Review, even if a past session was never marked complete.
function linkFor(s: SessionSummary): string {
	return `#/review/${s.id}`;
}

export function History() {
	// No `from` on purpose: history has no lower bound. The server treats a
	// missing `from` as "since the beginning" — it used to default to today,
	// which silently collapsed this whole screen to only today's sessions.
	const { sessions, error, reload } = useSessionList({ to: todayIso(), order: 'desc' }, 'Could not load history.');

	return (
		<main class="screen">
			<h1>History</h1>
			<p class="lede">Everything logged, newest first. Tap a session to see what happened, or fix what you recorded.</p>
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
				<SessionList sessions={sessions} linkFor={linkFor} emptyMessage="Nothing logged yet." />
			)}
		</main>
	);
}
