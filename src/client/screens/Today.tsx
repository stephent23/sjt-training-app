import { useEffect, useState } from 'preact/hooks';
import type { SessionDetail } from '../../types';
import { fetchToday } from '../api';
import { pendingCount } from '../sync';

interface TodayProps {
	onOpenSession: (id: number, kind: 'lift' | 'run') => void;
}

export function Today({ onOpenSession }: TodayProps) {
	const [detail, setDetail] = useState<SessionDetail | null | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [retryToken, setRetryToken] = useState(0);

	useEffect(() => {
		let cancelled = false;
		setError(null);
		fetchToday()
			.then((result) => {
				if (cancelled) return;
				setDetail(result);
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

	if (detail === undefined) {
		return (
			<main class="screen">
				<p>Loading…</p>
			</main>
		);
	}

	if (detail === null) {
		return (
			<main class="screen">
				<h1>Training log</h1>
				<p>Nothing planned. Enjoy the rest.</p>
			</main>
		);
	}

	const { session } = detail;

	return (
		<main class="screen">
			<h1>Training log</h1>
			{pending > 0 && <p class="eyebrow">Syncing {pending} change{pending === 1 ? '' : 's'}…</p>}
			<a class="today-card" href={`#/${session.kind}/${session.id}`} onClick={() => onOpenSession(session.id, session.kind)}>
				<p class="today-card-date">{session.date}</p>
				<h2>{session.label}</h2>
				<p>{session.status === 'completed' ? 'Completed — tap to review' : session.kind === 'lift' ? `${detail.plannedSets.length} exercises` : 'Tap to log'}</p>
			</a>
		</main>
	);
}
