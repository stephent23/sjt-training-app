// src/runProgression.ts — build plan §8: long run +10%/wk cap, easy runs stay easy.
export const MAX_WEEKLY_RUN_GROWTH = 0.1;
export type RunProgressionAction = 'increase_long_run' | 'hold_long_run' | 'hold_easy' | 'hold_quality';

export interface LoggedRunForProgression {
	distance_km: number;
	duration_seconds: number;
	rpe_1_10: number | null;
	avg_hr?: number | null;
	max_hr?: number | null;
}
export interface RunProgressionResult { action: RunProgressionAction; next_target_km: number | null; reason: string; }

/** Below this share of the target, the long run didn't really happen at its
 * prescribed distance. Set at 90% so a route that measured a little differently
 * still counts — this is meant to catch a run cut short, not GPS drift. */
const MIN_COMPLETION = 0.9;
/** RPE at or above this is a hard day, whatever the plan called it. */
const HARD_RPE = 8;
/** Average heart rate this close to the run's own maximum means it was run hard
 * regardless of how it felt afterwards. Compared against the max from the same
 * run rather than an age-predicted number, so it needs no profile data. */
const HARD_HR_SHARE = 0.95;

/**
 * Whether the last long run looked comfortable enough to build on. Absence of
 * evidence is not evidence of strain — a run with no RPE and no heart rate is
 * treated as fine, which is what happened for every run before those fields
 * existed.
 */
function strainReason(logged: LoggedRunForProgression, targetKm: number): string | null {
	if (logged.distance_km < targetKm * MIN_COMPLETION) {
		return `Last long run came up short of the ${targetKm}km target (${logged.distance_km}km) — holding rather than stacking distance on a run that didn't finish.`;
	}
	if (logged.rpe_1_10 !== null && logged.rpe_1_10 >= HARD_RPE) {
		return `Last long run went down as RPE ${logged.rpe_1_10} — holding until it settles rather than adding distance to a hard week.`;
	}
	if (logged.avg_hr != null && logged.max_hr != null && logged.max_hr > 0 && logged.avg_hr >= logged.max_hr * HARD_HR_SHARE) {
		return `Average heart rate sat at ${logged.avg_hr} against a max of ${logged.max_hr} — holding; that's a hard run however it felt.`;
	}
	return null;
}

export function progressRun(runType: 'easy' | 'tempo' | 'intervals' | 'long', lastWeekTargetKm: number | null, logged: LoggedRunForProgression | null): RunProgressionResult {
	if (runType !== 'long') {
		return { action: runType === 'easy' ? 'hold_easy' : 'hold_quality', next_target_km: lastWeekTargetKm, reason: runType === 'easy' ? 'Easy runs stay easy.' : 'Quality session — holding; frequency is a weekly-plan decision.' };
	}
	if (!logged || lastWeekTargetKm === null) {
		return { action: 'hold_long_run', next_target_km: lastWeekTargetKm, reason: 'No logged long run to grow from — holding.' };
	}

	// Growth used to follow from the mere existence of a logged run, so a run
	// cut half short or one that took everything you had earned the same 10% as
	// a comfortable one, and the plan climbed away from what was survivable.
	const strain = strainReason(logged, lastWeekTargetKm);
	if (strain) return { action: 'hold_long_run', next_target_km: lastWeekTargetKm, reason: strain };

	const grown = Math.round(lastWeekTargetKm * (1 + MAX_WEEKLY_RUN_GROWTH) * 10) / 10;
	return { action: 'increase_long_run', next_target_km: grown, reason: `Long run grows by the max allowed ${MAX_WEEKLY_RUN_GROWTH * 100}% — ${lastWeekTargetKm}km to ${grown}km.` };
}
