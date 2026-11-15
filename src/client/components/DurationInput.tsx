import { autoColon } from '../runFields';
import { RunField } from './RunField';

interface DurationInputProps {
	id: string;
	label: string;
	value: string;
	onInput: (value: string) => void;
	onCommit?: () => void;
	/** Pace fields carry a "/km" unit; plain durations have none. */
	suffix?: string;
	derived?: boolean;
	error?: string;
	placeholder?: string;
}

/** A time typed as digits on the numeric keypad: "2840" becomes 28:40 and
 * "10215" becomes 1:02:15 as you type (see autoColon), and one or two digits
 * stay plain minutes. The numeric keypad is the point — iOS's has no colon
 * key, and switching keyboards mid-entry is the slow part of logging a run.
 * Used for duration, average pace and interval pace alike. */
export function DurationInput({ id, label, value, onInput, onCommit, suffix, derived, error, placeholder = 'm:ss' }: DurationInputProps) {
	return (
		<RunField
			id={id}
			label={label}
			value={value}
			onInput={(raw) => onInput(autoColon(raw))}
			onCommit={onCommit}
			suffix={suffix}
			inputMode="numeric"
			placeholder={placeholder}
			derived={derived}
			error={error}
		/>
	);
}
