// src/progress.ts — what the Progress screen shows: where the next race stands
// against its target, the running build week by week, and the lifts that are
// trained often enough to have a trend. Pure: it reshapes the training summary
// and race context the export already builds, so the screen and the plan-writer
// can never disagree about the numbers.

import type { RaceContext } from './raceContext';
import { riegel, type EasyPaceTrend, type TrainingSummary } from './trainingSummary';

/** With no race entered, estimates are for a half marathon. */
const DEFAULT_DISTANCE_KM = 21.1;
/** Lifts shown: the ones logged in the most weeks. */
const MAX_LIFTS = 6;

export interface ProgressEstimate {
	/** Predicted time over the goal distance, whole seconds. */
	seconds: number;
	/** 'training_run' efforts understate race fitness; 'race' is a real result. */
	source: 'training_run' | 'race';
	/** The effort it was predicted from. */
	date: string;
	distance_km: number;
	effort_seconds: number;
}

export interface ProgressGoal {
	/** The next main race, else the next race of any kind; null with none ahead. */
	race: { name: string; date: string; days_until: number; target_seconds: number | null } | null;
	distance_km: number;
	/** Fastest prediction from the last 12 weeks' runs and the last year's races. */
	estimate: ProgressEstimate | null;
	/** Best recorded race at this distance. */
	pb: { seconds: number; date: string; name: string } | null;
	/** estimate − target: negative means ahead of target. Null without both. */
	gap_seconds: number | null;
}

export interface ProgressWeek {
	week_start: string;
	is_current: boolean;
	km: number;
	long_run_km: number;
	planned: number;
	completed: number;
}

export interface ProgressLift {
	exercise_id: number;
	name: string;
	/** Best estimated 1RM in each week it was trained, oldest first. */
	points: { week_start: string; e1rm_kg: number }[];
	last_e1rm_kg: number;
	change_kg: number;
}

export interface Progress {
	today: string;
	goal: ProgressGoal;
	/** 12 full weeks and the current one, oldest first. */
	weeks: ProgressWeek[];
	easy_pace: EasyPaceTrend;
	adherence_pct: number | null;
	lifts: ProgressLift[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function buildProgress(summary: TrainingSummary, raceContext: RaceContext): Progress {
	const next = raceContext.races.find((r) => r.priority === 'A') ?? raceContext.races[0] ?? null;
	const distanceKm = next?.distance_km ?? DEFAULT_DISTANCE_KM;

	let estimate: ProgressEstimate | null = null;
	for (const e of summary.run_fitness.race_estimates) {
		const seconds = riegel(e.seconds, e.distance_km, distanceKm);
		if (estimate === null || seconds < estimate.seconds) {
			estimate = { seconds, source: e.source, date: e.date, distance_km: e.distance_km, effort_seconds: e.seconds };
		}
	}

	// Same 0.1 km bucket the PB list is built with.
	const best = raceContext.personalBests.find((p) => Math.round(p.distance_km * 10) === Math.round(distanceKm * 10));

	const series = new Map<number, ProgressLift>();
	for (const week of summary.weeks) {
		for (const lift of week.lifting.exercises) {
			const entry = series.get(lift.exercise_id) ?? { exercise_id: lift.exercise_id, name: lift.name, points: [], last_e1rm_kg: 0, change_kg: 0 };
			entry.points.push({ week_start: week.week_start, e1rm_kg: lift.best_e1rm_kg });
			series.set(lift.exercise_id, entry);
		}
	}
	const lifts = [...series.values()]
		.filter((l) => l.points.length >= 2)
		.sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name))
		.slice(0, MAX_LIFTS)
		.map((l) => {
			const last = l.points[l.points.length - 1].e1rm_kg;
			return { ...l, last_e1rm_kg: last, change_kg: round1(last - l.points[0].e1rm_kg) };
		});

	return {
		today: summary.today,
		goal: {
			race: next ? { name: next.name, date: next.date, days_until: next.days_until, target_seconds: next.target_seconds } : null,
			distance_km: distanceKm,
			estimate,
			pb: best ? { seconds: best.result_seconds, date: best.date, name: best.name } : null,
			gap_seconds: estimate && next?.target_seconds != null ? estimate.seconds - next.target_seconds : null,
		},
		weeks: summary.weeks.map((w) => ({
			week_start: w.week_start,
			is_current: w.is_current,
			km: w.running.km,
			long_run_km: w.running.long_run_km,
			planned: w.adherence.planned,
			completed: w.adherence.completed,
		})),
		easy_pace: summary.run_fitness.easy_pace_trend,
		adherence_pct: summary.trends.adherence_pct,
		lifts,
	};
}
