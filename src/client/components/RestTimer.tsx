import { useEffect, useState } from 'preact/hooks';

interface RestTimerProps {
	totalSeconds: number;
	startedAt: number;
	onSkip: () => void;
}

function formatClock(totalSeconds: number): string {
	const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
	const ss = String(totalSeconds % 60).padStart(2, '0');
	return `${mm}:${ss}`;
}

// Visible without scrolling — rest is the state you're in for most of the session.
export function RestTimer({ totalSeconds, startedAt, onSkip }: RestTimerProps) {
	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 250);
		return () => clearInterval(id);
	}, []);

	const elapsed = Math.floor((now - startedAt) / 1000);
	const remaining = totalSeconds - elapsed;
	const over = remaining < 0;

	return (
		<div class={`rest-timer ${over ? 'rest-timer--over' : ''}`}>
			<span class="rest-timer-label">{over ? 'Over by' : 'Rest'}</span>
			<span class="rest-timer-clock">{formatClock(Math.abs(remaining))}</span>
			<button type="button" class="rest-timer-skip" onClick={onSkip}>
				Skip
			</button>
		</div>
	);
}
