const SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

function effortWord(rpe: number): string {
	if (rpe <= 2) return 'Very easy';
	if (rpe <= 4) return 'Easy';
	if (rpe <= 6) return 'Moderate';
	if (rpe <= 8) return 'Hard';
	return 'All out';
}

interface RpeScaleProps {
	/** The stored string state: '' for not rated. */
	value: string;
	onChange: (value: string) => void;
	error?: string;
}

/** RPE as ten tap targets in two rows of five rather than a number box. Tapping
 * the selected number again clears it — RPE is optional. */
export function RpeScale({ value, onChange, error }: RpeScaleProps) {
	const selected = Number(value) || null;

	return (
		<div class="rpe">
			<span class="run-field-label">
				How hard was it? <span class="rpe-word">{selected ? `${selected} · ${effortWord(selected)}` : 'optional'}</span>
			</span>
			<div class="rpe-scale" role="group" aria-label="Effort, 1 to 10">
				{SCALE.map((n) => (
					<button
						type="button"
						key={n}
						class={`tap-btn ${selected === n ? 'tap-btn--selected' : ''}`}
						aria-pressed={selected === n}
						onClick={() => onChange(selected === n ? '' : String(n))}
					>
						{n}
					</button>
				))}
			</div>
			{error && (
				<span class="run-field-error" role="alert">
					{error}
				</span>
			)}
		</div>
	);
}
