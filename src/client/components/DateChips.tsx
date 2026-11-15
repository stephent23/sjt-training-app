import { useEffect, useState } from 'preact/hooks';
import { addDaysIso, todayIso } from '../../dates';

interface DateChipsProps {
	value: string;
	onChange: (date: string) => void;
}

/** Today / Yesterday / Pick… — nearly every run is logged the day it
 * happened or the morning after, so those are one tap and the native date
 * picker only appears when asked for (or when the date is already something
 * else, e.g. correcting an older run). */
export function DateChips({ value, onChange }: DateChipsProps) {
	const today = todayIso();
	const yesterday = addDaysIso(today, -1);
	const [picking, setPicking] = useState(value !== today && value !== yesterday);

	// An edited run's date arrives after first paint; if it is an older one the
	// picker has to open for it, or the screen would show no date at all.
	useEffect(() => {
		if (value !== today && value !== yesterday) setPicking(true);
	}, [value]);

	const chip =(label: string, selected: boolean, onClick: () => void) => (
		<button
			type="button"
			class={`tap-btn ${selected ? 'tap-btn--selected' : ''}`}
			aria-pressed={selected}
			onClick={onClick}
		>
			{label}
		</button>
	);

	return (
		<div class="date-chips">
			<span class="run-field-label">Date</span>
			<div class="tap-row" role="group" aria-label="Date">
				{chip('Today', !picking && value === today, () => {
					setPicking(false);
					onChange(today);
				})}
				{chip('Yesterday', !picking && value === yesterday, () => {
					setPicking(false);
					onChange(yesterday);
				})}
				{chip('Pick…', picking, () => setPicking(true))}
			</div>
			{picking && (
				<label class="field run-field">
					<span class="run-field-label">Pick a date</span>
					<input type="date" value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
				</label>
			)}
		</div>
	);
}
