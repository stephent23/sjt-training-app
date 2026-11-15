interface RunFieldProps {
	id: string;
	label: string;
	value: string;
	onInput: (value: string) => void;
	/** Fires on the native `change` (blur with an edited value) — Review commits here. */
	onCommit?: () => void;
	/** A unit shown inside the field, after the value: km, bpm, spm, m, /km. */
	suffix?: string;
	placeholder?: string;
	inputMode?: 'decimal' | 'numeric' | 'text';
	/** True when the value is worked out from the other fields, not typed. */
	derived?: boolean;
	error?: string;
}

/** One labelled input for the run form: label above, unit inside the field,
 * and its own error underneath. Plain text inputs rather than type=number —
 * number inputs reject "28:40", scroll-change on desktop, and show spinners. */
export function RunField({ id, label, value, onInput, onCommit, suffix, placeholder, inputMode = 'decimal', derived, error }: RunFieldProps) {
	return (
		<label class={`field run-field${derived ? ' run-field--derived' : ''}${error ? ' run-field--error' : ''}`} for={id}>
			<span class="run-field-label">
				{label}
				{derived && <span class="run-field-tag">derived</span>}
			</span>
			<span class="run-field-box">
				<input
					id={id}
					type="text"
					inputmode={inputMode}
					autocomplete="off"
					placeholder={placeholder}
					value={value}
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={error ? `${id}-error` : undefined}
					// A derived value is a suggestion: selecting it on focus means the
					// first keystroke replaces it instead of appending to it.
					onFocus={derived ? (e) => (e.target as HTMLInputElement).select() : undefined}
					onInput={(e) => onInput((e.target as HTMLInputElement).value)}
					onChange={() => onCommit?.()}
				/>
				{suffix && <span class="run-field-suffix">{suffix}</span>}
			</span>
			{error && (
				<span class="run-field-error" id={`${id}-error`} role="alert">
					{error}
				</span>
			)}
		</label>
	);
}
