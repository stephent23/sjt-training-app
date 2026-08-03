import { useEffect, useState } from 'preact/hooks';
import type { SessionSummary } from '../../types';
import { todayIso } from '../../dates';
import { fetchSessions } from '../api';
import { SessionList } from '../components/SessionRow';
import { pendingCount } from '../sync';

// Today shows every session dated today — there can be more than one (e.g.
// a lift and a run on the same day, or two things rescheduled onto the same
// date). Unlike Plan, a planned session here links straight into live
// logging: Today is the "do this now" screen, Plan is just a preview.
function linkFor(s: SessionSummary): string {
	if (s.status === 'planned') return `#/${s.kind}/${s.id}`;
	return `#/review/${s.id}`;
}

export function Today() {
	const [sessions, setSessions] = useState<SessionSummary[] | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		const today = todayIso();
		fetchSessions({ from: today, to: today })
			.then((result) => {
				if (cancelled) return;
				setSessions(result);
			})
			.catch(() => {
				if (cancelled) return;
				setError('Could not load today.');
			});
		return () => {
			cancelled = true;
		};
	}, [retryToken]);

	const pending = pendingCount();

	if (error) {
		return (
			<main class="screen">
				<h1>Training log</h1>
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
				<p>Loading…</p>
			</main>
		);
	}

	return (
		<main class="screen">
			<h1>Training log</h1>
			{pending > 0 && (
				<p class="eyebrow">
					Syncing {pending} change{pending === 1 ? '' : 's'}…
				</p>
			)}
			<SessionList sessions={sessions} linkFor={linkFor} emptyMessage="Nothing planned today. Enjoy the rest." />
		</main>
	);
}
