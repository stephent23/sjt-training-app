// src/progression.ts — pure: no DB, no fetch, no Date.now(). Same shape as swaps.ts/setDefaults.ts.
export type ProgressionAction = 'increase_weight_reset_reps' | 'double_increase_weight' | 'increase_reps' | 'hold';

export interface LoggedSetForProgression { weight_kg: number; reps: number; rir: number; rest_taken_seconds: number | null; }
export interface ExercisePrescription { rep_low: number; rep_high: number; target_weight_kg: number | null; rest_seconds: number; increment_kg: number; }
export interface ProgressionResult { action: ProgressionAction; next_weight_kg: number | null; reason: string; restWasShort: boolean; }

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function progressExercise(prescription: ExercisePrescription, loggedSets: LoggedSetForProgression[]): ProgressionResult {
	const restWasShort = loggedSets.some((s) => s.rest_taken_seconds !== null && s.rest_taken_seconds < prescription.rest_seconds);

	if (loggedSets.length === 0) {
		return { action: 'hold', next_weight_kg: prescription.target_weight_kg, reason: 'No sets logged against this exercise last week — holding rather than guessing.', restWasShort: false };
	}

	const baselineWeight = prescription.target_weight_kg ?? median(loggedSets.map((s) => s.weight_kg));
	const allHitTop = loggedSets.every((s) => s.reps >= prescription.rep_high);
	const anyBelowLow = loggedSets.some((s) => s.reps < prescription.rep_low);
	const medianRir = median(loggedSets.map((s) => s.rir));

	if (allHitTop && medianRir <= 1) {
		return { action: 'increase_weight_reset_reps', next_weight_kg: baselineWeight + prescription.increment_kg, reason: `All sets hit ${prescription.rep_high} reps at median RIR ${medianRir} — weight increase earned; expect reps back near ${prescription.rep_low}.`, restWasShort };
	}
	if (allHitTop && medianRir >= 2) {
		return { action: 'double_increase_weight', next_weight_kg: baselineWeight + prescription.increment_kg * 2, reason: `All sets hit ${prescription.rep_high} reps with reps in reserve (median RIR ${medianRir}) — too light, taking a bigger jump.`, restWasShort };
	}
	if (!anyBelowLow) {
		return { action: 'increase_reps', next_weight_kg: baselineWeight, reason: `Reps landed in ${prescription.rep_low}-${prescription.rep_high} without maxing out — hold weight, aim for one more rep.`, restWasShort };
	}
	return {
		action: 'hold',
		next_weight_kg: baselineWeight,
		reason: restWasShort
			? `Reps fell short of ${prescription.rep_low}, and rest ran under the prescribed ${prescription.rest_seconds}s — fix rest before touching load again.`
			: `Reps fell short of ${prescription.rep_low} — hold and repeat the week.`,
		restWasShort,
	};
}
