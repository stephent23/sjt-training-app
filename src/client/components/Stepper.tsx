import { useState } from 'preact/hooks';

interface StepperProps {
	value: number;
	step: number;
	suffix?: string;
	onChange: (value: number) => void;
}

// Rounds float artefacts (from repeated += increment_kg additions) to 2dp.
// Does NOT snap to a multiple of `step` — that would be wrong: 22.5 + 2 = 24.5,
// and snapping to the nearest step would silently turn that into 24, destroying
// a legitimate weight. Keep this name accurate so nobody "fixes" it later.
function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

export function Stepper({ value, step, suffix, onChange }: StepperProps) {
	// draft === null means "not editing, show `value`". While focused we show
	// exactly what's typed, not a reformatted version of it — otherwise every
	// keystroke would round-trip through onChange and back down as `value`,
	// turning "22." into "22" and eating the decimal point mid-type.
	const [draft, setDraft] = useState<string | null>(null);

	function commit() {
		if (draft === null) return;
		const trimmed = draft.trim();
		const parsed = Number(trimmed);
		setDraft(null);
		if (trimmed === '' || !Number.isFinite(parsed)) return; // invalid — silently revert
		const next = round2(Math.max(0, parsed));
		// Only fire onChange if the value actually changed. A no-op focus+blur
		// must not "touch" this row — SetRow tracks an untouched field against
		// the current default (e.g. set 1's just-logged numbers), and a stray
		// onChange here would permanently detach it from that tracking even
		// though nothing was really edited.
		if (next !== value) onChange(next);
	}

	return (
		<div class="stepper">
			<button type="button" class="stepper-btn" onClick={() => onChange(round2(Math.max(0, value - step)))} aria-label="Decrease">
				−
			</button>
			<input
				class="stepper-input"
				type="number"
				inputmode="decimal"
				step="any"
				min="0"
				value={draft ?? String(value)}
				aria-label="Weight"
				onFocus={(e) => {
					setDraft(String(value));
					(e.target as HTMLInputElement).select();
				}}
				onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						(e.target as HTMLInputElement).blur();
					}
					if (e.key === 'Escape') {
						setDraft(null);
						(e.target as HTMLInputElement).blur();
					}
				}}
			/>
			{suffix && <span class="stepper-suffix">{suffix}</span>}
			<button type="button" class="stepper-btn" onClick={() => onChange(round2(value + step))} aria-label="Increase">
				+
			</button>
		</div>
	);
}
