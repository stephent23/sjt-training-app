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
	return (
		<div class="stepper">
			<button type="button" class="stepper-btn" onClick={() => onChange(round2(Math.max(0, value - step)))} aria-label="Decrease">
				−
			</button>
			<span class="stepper-value">
				{value}
				{suffix}
			</span>
			<button type="button" class="stepper-btn" onClick={() => onChange(round2(value + step))} aria-label="Increase">
				+
			</button>
		</div>
	);
}
