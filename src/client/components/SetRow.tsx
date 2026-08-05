import { useState } from 'preact/hooks';
import type { LoggedSetEntry } from '../../types';
import { Stepper } from './Stepper';
import { TapGroup } from './TapGroup';

interface SetRowProps {
	/** "Set 2" for a solo exercise; the exercise name inside a superset round,
	 *  where the round heading already carries the number. */
	label: string;
	repLow: number;
	repHigh: number;
	incrementKg: number;
	isBodyweight: boolean;
	defaultWeight: number;
	defaultReps: number | null;
	logged: LoggedSetEntry | undefined;
	lastWeek: LoggedSetEntry | undefined;
	/** Whether the full controls are shown. An unlogged set is always expanded;
	 *  a logged one collapses to a summary until you tap Edit. */
	expanded: boolean;
	onToggleExpand: () => void;
	onLog: (weightKg: number, reps: number, rir: number) => void;
}

const RIR_OPTIONS = [0, 1, 2, 3, 4];

export function SetRow({
	label,
	repLow,
	repHigh,
	incrementKg,
	isBodyweight,
	defaultWeight,
	defaultReps,
	logged,
	lastWeek,
	expanded,
	onToggleExpand,
	onLog,
}: SetRowProps) {
	// "Untouched" fields always track the CURRENT default props (which shift as
	// the parent re-renders after each set is logged) — touching a field locally
	// overrides that default until the next successful log resets the override.
	// This is what makes set 2 show set 1's just-logged numbers without any
	// key-remounting trickery: set 2's SetRow is mounted the whole time, but its
	// `weight`/`reps` are derived from props on every render, not seeded once.
	const [touchedWeight, setTouchedWeight] = useState<number | null>(null);
	const [touchedReps, setTouchedReps] = useState<number | null>(null);
	const [touchedRir, setTouchedRir] = useState<number | null>(null);

	const weight = touchedWeight ?? defaultWeight;
	// `logged?.reps` is the same value resolveSetDefaults already returns for a
	// logged set (precedence rule 1), so this changes nothing in practice — it
	// just means a logged row can never render un-updatable because of what the
	// parent passed, which is the failure mode this whole change is fixing.
	const reps = touchedReps ?? defaultReps ?? logged?.reps ?? null;

	// RIR follows the same untouched-tracks-the-default idiom, but its only
	// fallback is THIS set's own logged value — never lastWeek, never the
	// previous set. That distinction is the whole point: echoing back what you
	// just recorded keeps the chip visible (and the row re-editable) after
	// logging, whereas suggesting a value from anywhere else would get
	// confirmed without thought and quietly corrupt the signal every
	// progression decision runs on. See the note in src/setDefaults.ts.
	const rir = touchedRir ?? logged?.rir ?? null;

	const repOptions: number[] = [];
	for (let r = Math.max(0, repLow - 2); r <= repHigh + 2; r++) repOptions.push(r);

	const canLog = reps !== null && rir !== null;

	function handleLogClick() {
		if (!canLog) return;
		onLog(weight, reps!, rir!);
		setTouchedWeight(null);
		setTouchedReps(null);
		setTouchedRir(null);
	}

	// Done, and not being edited: one scannable line instead of ~400px of live
	// controls. The whole row is the tap target rather than a small Edit button
	// — this gets used one-handed, mid-workout, on a sweaty screen.
	if (logged && !expanded) {
		return (
			<button type="button" class="set-row set-row--collapsed" aria-expanded={false} aria-label={`Edit ${label}`} onClick={onToggleExpand}>
				<span class="set-row-index">{label}</span>
				<span class="set-row-summary">
					{isBodyweight ? '' : `${logged.weight_kg}kg × `}
					{logged.reps} @ RIR {logged.rir}
				</span>
				<span class="set-row-edit">Edit</span>
			</button>
		);
	}

	return (
		<div class={`set-row ${logged ? 'set-row--editing' : ''}`}>
			<div class="set-row-header">
				<span class="set-row-index">{label}</span>
				{lastWeek && (
					<span class="set-row-lastweek">
						Last: {lastWeek.weight_kg}kg × {lastWeek.reps} @ RIR {lastWeek.rir}
					</span>
				)}
			</div>

			<div class="set-field">
				<span class="eyebrow">Weight</span>
				{isBodyweight ? (
					<p class="set-field-hint">Bodyweight — no added load</p>
				) : (
					<>
						<p class="set-field-hint">Tap the number to type, or use ± to adjust by {incrementKg}kg</p>
						<Stepper value={weight} step={incrementKg} suffix="kg" onChange={setTouchedWeight} />
					</>
				)}
			</div>

			<div class="set-field">
				<span class="eyebrow">
					Reps · target {repLow}-{repHigh}
				</span>
				<TapGroup
					options={repOptions}
					value={reps}
					onChange={setTouchedReps}
					label={(r) => String(r)}
					ariaLabel={`Reps for ${label}, target ${repLow} to ${repHigh}`}
					isTarget={(r) => r >= repLow && r <= repHigh}
				/>
			</div>

			<div class="set-field">
				<span class="eyebrow">RIR · reps in reserve</span>
				<p class="set-field-hint">0 = couldn't do another rep · 4 = several left</p>
				<TapGroup
					options={RIR_OPTIONS}
					value={rir}
					onChange={setTouchedRir}
					label={(v) => String(v)}
					ariaLabel={`RIR for ${label}, reps in reserve: how many more reps you could have done`}
				/>
			</div>

			<button type="button" class="btn-primary" disabled={!canLog} onClick={handleLogClick}>
				{logged ? 'Update set' : 'Log set'}
			</button>

			{logged && (
				<button type="button" class="btn-secondary" onClick={onToggleExpand}>
					Done editing
				</button>
			)}
		</div>
	);
}
