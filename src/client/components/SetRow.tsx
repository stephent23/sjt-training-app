import { useState } from 'preact/hooks';
import type { LoggedSetEntry } from '../../types';
import { Stepper } from './Stepper';

interface SetRowProps {
	setIndex: number;
	repLow: number;
	repHigh: number;
	incrementKg: number;
	isBodyweight: boolean;
	defaultWeight: number;
	logged: LoggedSetEntry | undefined;
	lastWeek: LoggedSetEntry | undefined;
	onLog: (weightKg: number, reps: number, rir: number) => void;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4];

export function SetRow({ setIndex, repLow, repHigh, incrementKg, isBodyweight, defaultWeight, logged, lastWeek, onLog }: SetRowProps) {
	const [weight, setWeight] = useState(logged?.weight_kg ?? defaultWeight);
	const [reps, setReps] = useState<number | null>(logged?.reps ?? null);
	const [rir, setRir] = useState<number | null>(logged?.rir ?? null);

	const repOptions: number[] = [];
	for (let r = Math.max(0, repLow - 2); r <= repHigh + 2; r++) repOptions.push(r);

	const canLog = reps !== null && rir !== null;

	return (
		<div class={`set-row ${logged ? 'set-row--logged' : ''}`}>
			<div class="set-row-header">
				<span class="set-row-index">Set {setIndex}</span>
				{lastWeek && (
					<span class="set-row-lastweek">
						Last: {lastWeek.weight_kg}kg × {lastWeek.reps} @ RIR {lastWeek.rir}
					</span>
				)}
			</div>

			{!isBodyweight && <Stepper value={weight} step={incrementKg} suffix="kg" onChange={setWeight} />}

			<div class="tap-row" role="group" aria-label="Reps">
				{repOptions.map((r) => (
					<button
						type="button"
						key={r}
						class={`tap-btn ${reps === r ? 'tap-btn--selected' : ''} ${r >= repLow && r <= repHigh ? 'tap-btn--target' : ''}`}
						onClick={() => setReps(r)}
					>
						{r}
					</button>
				))}
			</div>

			<div class="tap-row" role="group" aria-label="Reps in reserve">
				{RIR_OPTIONS.map((v) => (
					<button type="button" key={v} class={`tap-btn ${rir === v ? 'tap-btn--selected' : ''}`} onClick={() => setRir(v)}>
						RIR {v}
					</button>
				))}
			</div>

			<button type="button" class="btn-primary" disabled={!canLog} onClick={() => canLog && onLog(weight, reps!, rir!)}>
				{logged ? 'Update set' : 'Log set'}
			</button>
		</div>
	);
}
