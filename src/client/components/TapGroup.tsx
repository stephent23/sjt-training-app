// Generic "labelled row of tappable options, exactly one selected" — the
// pattern currently hand-written separately for SetRow's rep row, SetRow's
// RIR row, RunSession's RPE row, and SwapSheet's several option rows as
// `class={`tap-btn ${x === v ? 'tap-btn--selected' : ''}`}`. Not yet wired
// into those call sites — that's for the next round of screen work.

interface TapGroupProps<T> {
	options: T[];
	value: T | null;
	onChange: (value: T) => void;
	label: (option: T) => string;
	ariaLabel: string;
	stacked?: boolean;
	isTarget?: (option: T) => boolean; // e.g. reps within the prescribed range
}

export function TapGroup<T>({ options, value, onChange, label, ariaLabel, stacked, isTarget }: TapGroupProps<T>) {
	return (
		<div class={`tap-row ${stacked ? 'tap-row--stacked' : ''}`} role="group" aria-label={ariaLabel}>
			{options.map((opt, i) => (
				<button
					type="button"
					key={i}
					class={`tap-btn ${value === opt ? 'tap-btn--selected' : ''} ${isTarget?.(opt) ? 'tap-btn--target' : ''}`}
					aria-pressed={value === opt}
					onClick={() => onChange(opt)}
				>
					{label(opt)}
				</button>
			))}
		</div>
	);
}
