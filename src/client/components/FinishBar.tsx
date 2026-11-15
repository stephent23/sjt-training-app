import { useState } from 'preact/hooks';

interface FinishBarProps {
	status: 'planned' | 'completed' | 'skipped';
	/** Lift sessions soften "Mark complete" to secondary until every set is logged. */
	primary?: boolean;
	onComplete: () => void;
	onSkip: () => void;
}

// The sticky bottom bar of the lift and run screens: finishing is the
// commonest last tap, so it sits under the thumb however far down the screen
// you are. Skipping is a quiet second action and asks first (the same
// two-step inline pattern as RunEditor's delete) — it sits right under the
// primary button and is easy to hit by accident.
export function FinishBar({ status, primary = true, onComplete, onSkip }: FinishBarProps) {
	const [confirming, setConfirming] = useState(false);

	return (
		<div class="run-actionbar finish-bar">
			<button type="button" class={primary ? 'btn-primary' : 'btn-secondary'} disabled={status === 'completed'} onClick={onComplete}>
				{status === 'completed' ? 'Completed' : 'Mark complete'}
			</button>
			{confirming ? (
				<div class="finish-bar-confirm" role="group" aria-label="Skip this session?">
					<span class="finish-bar-ask">Skip this session?</span>
					<button type="button" class="btn-danger" onClick={onSkip}>
						Yes, skip
					</button>
					<button type="button" class="btn-quiet" onClick={() => setConfirming(false)}>
						Keep it
					</button>
				</div>
			) : (
				<button type="button" class="btn-quiet" disabled={status === 'skipped'} onClick={() => setConfirming(true)}>
					{status === 'skipped' ? 'Skipped' : 'Mark skipped'}
				</button>
			)}
		</div>
	);
}
