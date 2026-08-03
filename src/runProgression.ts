// src/runProgression.ts — build plan §8: long run +10%/wk cap, easy runs stay easy.
export const MAX_WEEKLY_RUN_GROWTH = 0.1;
export type RunProgressionAction = 'increase_long_run' | 'hold_long_run' | 'hold_easy' | 'hold_quality';

export interface LoggedRunForProgression { distance_km: number; duration_seconds: number; rpe_1_10: number | null; }
export interface RunProgressionResult { action: RunProgressionAction; next_target_km: number | null; reason: string; }

export function progressRun(runType: 'easy' | 'tempo' | 'intervals' | 'long', lastWeekTargetKm: number | null, logged: LoggedRunForProgression | null): RunProgressionResult {
	if (runType !== 'long') {
		return { action: runType === 'easy' ? 'hold_easy' : 'hold_quality', next_target_km: lastWeekTargetKm, reason: runType === 'easy' ? 'Easy runs stay easy.' : 'Quality session — holding; frequency is a weekly-plan decision.' };
	}
	if (!logged || lastWeekTargetKm === null) {
		return { action: 'hold_long_run', next_target_km: lastWeekTargetKm, reason: 'No logged long run to grow from — holding.' };
	}
	const grown = Math.round(lastWeekTargetKm * (1 + MAX_WEEKLY_RUN_GROWTH) * 10) / 10;
	return { action: 'increase_long_run', next_target_km: grown, reason: `Long run grows by the max allowed ${MAX_WEEKLY_RUN_GROWTH * 100}% — ${lastWeekTargetKm}km to ${grown}km.` };
}
