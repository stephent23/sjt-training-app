import { useState } from 'preact/hooks';
import type { Race } from '../../types';
import { addDaysIso, daysBetweenIso, isMondayIso, todayIso, weekStartOnOrAfter } from '../../dates';
import { Icon } from './Icon';

export const MIN_WEEKS = 1;
export const MAX_WEEKS = 12;
export const DEFAULT_WEEKS = 8;

const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "Mon 16 Nov" for an ISO date. UTC on purpose: a plain date has no zone. */
export function shortDate(dateIso: string): string {
	const [y, m, d] = dateIso.split('-').map(Number);
	return SHORT_DATE.format(new Date(Date.UTC(y, m - 1, d)));
}

/** Why a start date can't be used, or null. Mirrors what the server enforces
 * (a real Monday, today or later), so the button is never offered for a date
 * that is going to be refused. */
export function startDateError(date: string): string | null {
	if (!isMondayIso(date)) return 'Plans start on a Monday — pick one.';
	if (date < todayIso()) return 'That Monday has already passed.';
	return null;
}

interface StartPickerProps {
	value: string;
	onChange: (date: string) => void;
}

/** "Starts": the two Mondays you would actually choose are one tap each; any
 * other Monday opens the native date picker. */
export function StartPicker({ value, onChange }: StartPickerProps) {
	const first = weekStartOnOrAfter(todayIso());
	const second = addDaysIso(first, 7);
	const [picking, setPicking] = useState(value !== first && value !== second);
	const error = startDateError(value);

	const chip = (label: string, sub: string, selected: boolean, onClick: () => void) => (
		<button type="button" class={`tap-btn start-chip ${selected ? 'tap-btn--selected' : ''}`} aria-pressed={selected} onClick={onClick}>
			<span class="start-chip-label">{label}</span>
			<span class="start-chip-sub">{sub}</span>
		</button>
	);

	return (
		<div class="field">
			<div class="tap-row start-row" role="group" aria-label="Starts">
				{chip(first === todayIso() ? 'Today' : 'Next Monday', shortDate(first), !picking && value === first, () => {
					setPicking(false);
					onChange(first);
				})}
				{chip('Week after', shortDate(second), !picking && value === second, () => {
					setPicking(false);
					onChange(second);
				})}
				{chip('Pick', picking && !error ? shortDate(value) : 'Other date', picking, () => setPicking(true))}
			</div>
			{picking && (
				<label class="field">
					<span class="visually-hidden">Start date</span>
					<input type="date" value={value} min={todayIso()} step={7} onInput={(e) => onChange((e.target as HTMLInputElement).value)} />
				</label>
			)}
			{error && <p class="eyebrow--accent run-field-error" role="alert">{error}</p>}
		</div>
	);
}

interface WeeksControlProps {
	value: number;
	onChange: (weeks: number) => void;
}

/** A − / + control rather than Stepper: Stepper is a text field that commits
 * on blur (see docs/roadmap.md), which is wrong for a value you only ever nudge
 * by one. No typing at all, so nothing to validate. */
export function WeeksControl({ value, onChange }: WeeksControlProps) {
	return (
		<div class="weeks-control" role="group" aria-label="Weeks">
			<button
				type="button"
				class="stepper-btn"
				aria-label="One week fewer"
				disabled={value <= MIN_WEEKS}
				onClick={() => onChange(Math.max(MIN_WEEKS, value - 1))}
			>
				<Icon name="minus" />
			</button>
			<span class="weeks-control-value" role="status" aria-live="polite">
				<span class="weeks-control-n">{value}</span> {value === 1 ? 'week' : 'weeks'}
			</span>
			<button
				type="button"
				class="stepper-btn"
				aria-label="One week more"
				disabled={value >= MAX_WEEKS}
				onClick={() => onChange(Math.min(MAX_WEEKS, value + 1))}
			>
				<Icon name="plus" />
			</button>
		</div>
	);
}

/** "Ends Sun 7 Feb · Brighton Half is 5 weeks later" — how the block sits
 * against the soonest upcoming race that has no result yet. */
export function blockEndLine(startDate: string, weeks: number, races: Pick<Race, 'name' | 'date' | 'result_seconds'>[], today: string): string {
	const end = addDaysIso(startDate, weeks * 7 - 1);
	const line = `Ends ${shortDate(end)}`;
	const race = races.filter((r) => r.date >= today && r.result_seconds == null).sort((a, b) => a.date.localeCompare(b.date))[0];
	if (!race || race.date < startDate) return line;
	if (race.date <= end) return `${line} · ${race.name} falls in week ${Math.floor(daysBetweenIso(startDate, race.date) / 7) + 1}`;
	const later = Math.max(1, Math.round(daysBetweenIso(end, race.date) / 7));
	return `${line} · ${race.name} is ${later} ${later === 1 ? 'week' : 'weeks'} later`;
}
