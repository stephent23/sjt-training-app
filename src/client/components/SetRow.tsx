import { useState } from 'preact/hooks';
import type { LoggedSetEntry } from '../../types';
import { Stepper } from './Stepper';
import { TapGroup } from './TapGroup';

interface SetRowProps {
	setIndex: number;
	repLow: number;
	repHigh: number;
	incrementKg: number;
	isBodyweight: boolean;
	defaultWeight: number;
	defaultReps: number | null;
	logged: LoggedSetEntry | undefined;
	lastWeek: LoggedSetEntry | undefined;
	onLog: (weightKg: number, reps: number, rir: number) => void;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4];

export function SetRow({ setIndex, repLow, repHigh, incrementKg, isBodyweight, defaultWeight, defaultReps, logged, lastWeek, onLog }: SetRowProps) {
	// "Untouched" fields always track the CURRENT default props (which shift as
	// the parent re-renders after each set is logged) — touching a field locally
	// overrides that default until the next successful log resets the override.
	// This is what makes set 2 show set 1's just-logged numbers without any
	// key-remounting trickery: set 2's SetRow is mounted the whole time, but its
	// `weight`/`reps` are derived from props on every render, not seeded once.
	const [touchedWeight, setTouchedWeight] = useState<number | null>(null);
	const [touchedReps, setTouchedReps] = useState<number | null>(null);
	const [rir, setRir] = useState<number | null>(logged?.rir ?? null); // RIR still never prefills

	const weight = touchedWeight ?? defaultWeight;
	const reps = touchedReps ?? defaultReps;

	const repOptions: number[] = [];
	for (let r = Math.max(0, repLow - 2); r <= repHigh + 2; r++) repOptions.push(r);

	const canLog = reps !== null && rir !== null;

	function handleLogClick() {
		if (!canLog) return;
		onLog(weight, reps!, rir!);
		setTouchedWeight(null);
		setTouchedReps(null);
		setRir(null);
	}

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

			{!isBodyweight && <Stepper value={weight} step={incrementKg} suffix="kg" onChange={setTouchedWeight} />}

			<TapGroup
				options={repOptions}
				value={reps}
				onChange={setTouchedReps}
				label={(r) => String(r)}
				ariaLabel="Reps"
				isTarget={(r) => r >= repLow && r <= repHigh}
			/>

			<TapGroup options={RIR_OPTIONS} value={rir} onChange={setRir} label={(v) => `RIR ${v}`} ariaLabel="Reps in reserve" />

			<button type="button" class="btn-primary" disabled={!canLog} onClick={handleLogClick}>
				{logged ? 'Update set' : 'Log set'}
			</button>
		</div>
	);
}
