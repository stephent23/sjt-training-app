import { useEffect, useState } from 'preact/hooks';
import type { SessionDetail } from '../../types';
import { fetchToday } from '../api';

interface TodayProps {
	onOpenSession: (id: number, kind: 'lift' | 'run') => void;
}

export function Today({ onOpenSession }: TodayProps) {
	const [detail, setDetail] = useState<SessionDetail | null | undefined>(undefined);

	useEffect(() => {
		fetchToday().then(setDetail);
	}, []);

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
			<div class="today-card" onClick={() => onOpenSession(session.id, session.kind)}>
				<p class="today-card-date">{session.date}</p>
				<h2>{session.label}</h2>
				<p>{session.status === 'completed' ? 'Completed — tap to review' : session.kind === 'lift' ? `${detail.plannedSets.length} exercises` : 'Tap to log'}</p>
			</div>
		</main>
	);
}
