interface StepperProps {
	value: number;
	step: number;
	suffix?: string;
	onChange: (value: number) => void;
}

function roundToStep(value: number): number {
	return Math.round(value * 100) / 100;
}

export function Stepper({ value, step, suffix, onChange }: StepperProps) {
	return (
		<div class="stepper">
			<button type="button" class="stepper-btn" onClick={() => onChange(roundToStep(Math.max(0, value - step)))} aria-label="Decrease">
				−
			</button>
			<span class="stepper-value">
				{value}
				{suffix}
			</span>
			<button type="button" class="stepper-btn" onClick={() => onChange(roundToStep(value + step))} aria-label="Increase">
				+
			</button>
		</div>
	);
}
