import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { SessionList } from '../components/SessionRow';
import { pendingCount } from '../sync';
import { useSessionList } from '../useSessionList';

// Today shows every session dated today — there can be more than one (e.g.
// a lift and a run on the same day, or two things rescheduled onto the same
// date). Unlike Plan, a planned session here links straight into live
// logging: Today is the "do this now" screen, Plan is just a preview.
function linkFor(s: SessionSummary): string {
	if (s.status === 'planned') return `#/${s.kind}/${s.id}`;
	return `#/review/${s.id}`;
}

export function Today() {
	const today = todayIso();
	const { sessions, error, reload } = useSessionList({ from: today, to: today }, 'Could not load today.');
	const pending = pendingCount();

	return (
		<main class="screen">
			<h1>Training log</h1>
			{pending > 0 && (
				<p class="eyebrow">
					Syncing {pending} change{pending === 1 ? '' : 's'}…
				</p>
			)}
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
				<SessionList sessions={sessions} linkFor={linkFor} emptyMessage="Nothing planned today. Enjoy the rest." />
			)}
		</main>
	);
}
