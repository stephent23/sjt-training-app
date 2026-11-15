// src/trainingSummary.ts — a compact multi-week digest of training for the AI
// plan generator. The two-week lift window and six-week run window in
// generator.ts hand over raw rows; this hands over per-week aggregates plus a
// handful of trends, so a longer horizon fits in the prompt without dumping
// every set. Read-only: nothing here writes to the database.
//
// Window: `weeks` full Monday–Sunday weeks ending the Sunday before the week
// containing `today`, plus the current week so far (Monday through today). That
// gives weeks + 1 buckets, oldest first, keyed by their Monday. Every bucket is
// present even when empty, so gaps show up as zeros rather than missing rows.
//
// Only past and today's data counts: anything dated after `today` is excluded.
// Adherence and pain are attributed by session date; lifting and running by the
// date they were actually performed (performed_on).

import { addDaysIso } from './dates';
import { RUN_TYPES, type RunType } from './types';

/** Sets with this many reps in reserve or fewer count as hard. */
const HARD_SET_MAX_RIR = 3;
/** Threshold distances for best efforts, km. */
const BEST_EFFORT_KM = [5, 10, 15, 21];
const TEN_K_KM = 10;
const HALF_MARATHON_KM = 21.1;
/** Runs longer than this count toward weeks_with_long_run_over_16km. */
const LONG_RUN_KM = 16;
/** Races with a result are estimated only while this recent. */
const RACE_LOOKBACK_DAYS = 365;

export interface WeekAdherence {
	/** Planned sessions dated in this week (manual runs excluded). */
	planned: number;
	completed: number;
	skipped: number;
}

export interface WeekExerciseLift {
	exercise_id: number;
	name: string;
	/** Highest Epley e1RM across the week's sets, 1 dp. */
	best_e1rm_kg: number;
	/** Heaviest weight lifted this week, 1 dp. */
	top_weight_kg: number;
}

export interface WeekLifting {
	/** Exercises with at least one logged set this week, sorted by name. */
	exercises: WeekExerciseLift[];
	/** Hard sets (RIR <= 3) per exercise pattern. A missing key means zero. */
	hard_sets_by_pattern: Record<string, number>;
}

export interface WeekRunning {
	km: number;
	runs: number;
	/** Longest single run this week, 0 when there were none. */
	long_run_km: number;
	/** Mean of the runs that recorded an RPE, 1 dp. */
	avg_rpe: number | null;
	/** Mean of the runs that recorded an average HR, 1 dp. */
	avg_hr: number | null;
}

export interface WeekPain {
	/** Highest shoulder pain (0-3) recorded in a session this week. */
	max_shoulder: number | null;
	/** Highest back pain (0-3) recorded in a session this week. */
	max_back: number | null;
}

export interface WeekSummary {
	/** Monday of the week, YYYY-MM-DD. */
	week_start: string;
	/** True for the last bucket only: the week containing today, counted to date. */
	is_current: boolean;
	adherence: WeekAdherence;
	lifting: WeekLifting;
	running: WeekRunning;
	pain: WeekPain;
}

export interface ExerciseTrend {
	exercise_id: number;
	name: string;
	/** First and last week in the window with a logged set for this exercise. */
	first_week: string;
	last_week: string;
	first_e1rm_kg: number;
	last_e1rm_kg: number;
	/** Null when the exercise appears in only one week. */
	change_kg: number | null;
	change_pct: number | null;
}

export interface WeeklyKmTrend {
	/** Full weeks only: the current partial week is left out, since a Monday
	 * morning would otherwise read as a collapse in volume. */
	first_week: string;
	last_week: string;
	first_km: number;
	last_km: number;
	change_km: number;
	change_pct: number | null;
}

export interface RunTypeFitness {
	runs: number;
	km: number;
	/** Total seconds over total km, whole seconds. Null with no runs. */
	avg_pace_seconds_per_km: number | null;
	/** Null when no run of this type logged an HR. */
	avg_hr: number | null;
}

export interface EasyPaceTrend {
	/** Easy-run pace in the earlier and later half of the window. Null unless both halves have easy runs. */
	first_seconds_per_km: number | null;
	last_seconds_per_km: number | null;
	/** Easy-run avg HR in each half. Null unless both halves have an easy run with HR. */
	first_avg_hr: number | null;
	last_avg_hr: number | null;
}

export interface BestEffort {
	/** Threshold distance this run qualifies for, km. */
	min_km: number;
	date: string;
	distance_km: number;
	duration_seconds: number;
	pace_seconds_per_km: number;
	avg_hr: number | null;
}

export interface RaceEstimate {
	/** 'training_run' efforts understate race fitness; 'race' rows are real results. */
	source: 'training_run' | 'race';
	date: string;
	distance_km: number;
	seconds: number;
	/** Riegel equivalents, whole seconds. */
	ten_k_seconds: number;
	half_marathon_seconds: number;
}

export interface RunFitness {
	by_type: Record<RunType, RunTypeFitness>;
	easy_pace_trend: EasyPaceTrend;
	/** One entry per threshold that has a qualifying run, shortest threshold first. */
	best_efforts: BestEffort[];
	race_estimates: RaceEstimate[];
	longest_run_km: number;
	weeks_with_long_run_over_16km: number;
}

export interface TrainingSummary {
	today: string;
	/** Monday of the first bucket. */
	window_start: string;
	/** Monday of the current (partial) week. */
	current_week_start: string;
	/** weeks + 1 entries, oldest first. */
	weeks: WeekSummary[];
	trends: {
		exercises: ExerciseTrend[];
		/** Null with fewer than two full weeks in the window. */
		weekly_km: WeeklyKmTrend | null;
		/** Completed / planned over the whole window, including the current week so far. */
		adherence_pct: number | null;
	};
	run_fitness: RunFitness;
}

interface SessionRow {
	id: number;
	date: string;
	status: 'planned' | 'completed' | 'skipped';
	origin: 'planned' | 'manual';
	shoulder_pain_0_3: number | null;
	back_pain_0_3: number | null;
}

interface SetRow {
	exercise_id: number;
	name: string;
	pattern: string;
	weight_kg: number;
	reps: number;
	rir: number;
	performed_on: string;
}

interface RunRow {
	distance_km: number;
	duration_seconds: number;
	avg_hr: number | null;
	rpe_1_10: number | null;
	performed_on: string;
	/** From planned_runs; null for manual runs that were never given a type. */
	run_type: RunType | null;
}

interface RaceRow {
	date: string;
	distance_km: number;
	result_seconds: number;
}

/** Epley estimated one-rep max. */
function estimateOneRepMax(weightKg: number, reps: number): number {
	return weightKg * (1 + reps / 30);
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

function percentChange(from: number, to: number): number | null {
	return from === 0 ? null : round1(((to - from) / from) * 100);
}

function maxOrNull(current: number | null, candidate: number | null): number | null {
	if (candidate === null) return current;
	return current === null ? candidate : Math.max(current, candidate);
}

/** Monday of the ISO week containing `dateIso`. */
function mondayOf(dateIso: string): string {
	const [year, month, day] = dateIso.split('-').map(Number);
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // Sunday = 0
	return addDaysIso(dateIso, -((weekday + 6) % 7));
}

interface PaceTotals {
	runs: number;
	km: number;
	seconds: number;
	hrSum: number;
	hrCount: number;
}

function paceTotals(runs: RunRow[]): PaceTotals {
	const t: PaceTotals = { runs: 0, km: 0, seconds: 0, hrSum: 0, hrCount: 0 };
	for (const r of runs) {
		t.runs += 1;
		t.km += r.distance_km;
		t.seconds += r.duration_seconds;
		if (r.avg_hr !== null) {
			t.hrSum += r.avg_hr;
			t.hrCount += 1;
		}
	}
	return t;
}

function paceOf(t: PaceTotals): number | null {
	return t.km > 0 ? Math.round(t.seconds / t.km) : null;
}

function hrOf(t: PaceTotals): number | null {
	return t.hrCount > 0 ? round1(t.hrSum / t.hrCount) : null;
}

/** Riegel prediction: time over distance D1 converted to distance D2. */
function riegel(seconds: number, fromKm: number, toKm: number): number {
	return Math.round(seconds * Math.pow(toKm / fromKm, 1.06));
}

function raceEstimate(source: RaceEstimate['source'], date: string, distanceKm: number, seconds: number): RaceEstimate {
	return {
		source,
		date,
		distance_km: round1(distanceKm),
		seconds,
		ten_k_seconds: riegel(seconds, distanceKm, TEN_K_KM),
		half_marathon_seconds: riegel(seconds, distanceKm, HALF_MARATHON_KM),
	};
}

/**
 * Run fitness from the window's logged runs and the recent races. `splitWeek`
 * is the Monday that divides the window into its earlier and later halves.
 * Runs with no distance or no duration are ignored throughout.
 */
function buildRunFitness(runs: RunRow[], races: RaceRow[], splitWeek: string): RunFitness {
	const valid = runs.filter((r) => r.distance_km > 0 && r.duration_seconds > 0);

	const byType = {} as Record<RunType, RunTypeFitness>;
	for (const type of RUN_TYPES) {
		const t = paceTotals(valid.filter((r) => r.run_type === type));
		byType[type] = { runs: t.runs, km: round1(t.km), avg_pace_seconds_per_km: paceOf(t), avg_hr: hrOf(t) };
	}

	const easy = valid.filter((r) => r.run_type === 'easy');
	const earlier = paceTotals(easy.filter((r) => r.performed_on < splitWeek));
	const later = paceTotals(easy.filter((r) => r.performed_on >= splitWeek));
	const paceKnown = earlier.runs > 0 && later.runs > 0;
	const hrKnown = earlier.hrCount > 0 && later.hrCount > 0;
	const easyPaceTrend: EasyPaceTrend = {
		first_seconds_per_km: paceKnown ? paceOf(earlier) : null,
		last_seconds_per_km: paceKnown ? paceOf(later) : null,
		first_avg_hr: hrKnown ? hrOf(earlier) : null,
		last_avg_hr: hrKnown ? hrOf(later) : null,
	};

	const bestEfforts: BestEffort[] = [];
	const raceEstimates: RaceEstimate[] = [];
	for (const minKm of BEST_EFFORT_KM) {
		let best: RunRow | null = null;
		for (const r of valid) {
			if (r.distance_km < minKm) continue;
			if (best === null || r.duration_seconds / r.distance_km < best.duration_seconds / best.distance_km) best = r;
		}
		if (best === null) continue;
		bestEfforts.push({
			min_km: minKm,
			date: best.performed_on,
			distance_km: round1(best.distance_km),
			duration_seconds: best.duration_seconds,
			pace_seconds_per_km: Math.round(best.duration_seconds / best.distance_km),
			avg_hr: best.avg_hr,
		});
		raceEstimates.push(raceEstimate('training_run', best.performed_on, best.distance_km, best.duration_seconds));
	}
	for (const race of races) {
		raceEstimates.push(raceEstimate('race', race.date, race.distance_km, race.result_seconds));
	}

	const longest = valid.reduce((max, r) => Math.max(max, r.distance_km), 0);
	const longWeeks = new Set(valid.filter((r) => r.distance_km > LONG_RUN_KM).map((r) => mondayOf(r.performed_on)));

	return {
		by_type: byType,
		easy_pace_trend: easyPaceTrend,
		best_efforts: bestEfforts,
		race_estimates: raceEstimates,
		longest_run_km: round1(longest),
		weeks_with_long_run_over_16km: longWeeks.size,
	};
}

interface WeekAccumulator {
	adherence: WeekAdherence;
	lifts: Map<number, { exercise_id: number; name: string; best: number; top: number }>;
	hardByPattern: Map<string, number>;
	km: number;
	runs: number;
	longRunKm: number;
	rpeSum: number;
	rpeCount: number;
	hrSum: number;
	hrCount: number;
	shoulder: number | null;
	back: number | null;
}

function newAccumulator(): WeekAccumulator {
	return {
		adherence: { planned: 0, completed: 0, skipped: 0 },
		lifts: new Map(),
		hardByPattern: new Map(),
		km: 0,
		runs: 0,
		longRunKm: 0,
		rpeSum: 0,
		rpeCount: 0,
		hrSum: 0,
		hrCount: 0,
		shoulder: null,
		back: null,
	};
}

/**
 * Four bulk reads (sessions with their feedback, logged sets, logged runs,
 * recent races) aggregated in memory. Single-user data, so a few hundred
 * rows at most; per-week queries would only add round trips.
 */
export async function buildTrainingSummary(db: D1Database, today: string, weeks = 12): Promise<TrainingSummary> {
	const currentWeekStart = mondayOf(today);
	const windowStart = addDaysIso(currentWeekStart, -7 * weeks);
	const weekStarts = Array.from({ length: weeks + 1 }, (_, i) => addDaysIso(windowStart, 7 * i));

	const [sessionRes, setRes, runRes, raceRes] = await Promise.all([
		db
			.prepare(
				`SELECT s.id, s.date, s.status, s.origin, f.shoulder_pain_0_3, f.back_pain_0_3
				 FROM sessions s LEFT JOIN session_feedback f ON f.session_id = s.id
				 WHERE s.date >= ?1 AND s.date <= ?2`,
			)
			.bind(windowStart, today)
			.all<SessionRow>(),
		db
			.prepare(
				`SELECT ls.exercise_id, e.name, e.pattern, ls.weight_kg, ls.reps, ls.rir, ls.performed_on
				 FROM logged_sets ls JOIN exercises e ON e.id = ls.exercise_id
				 WHERE ls.performed_on >= ?1 AND ls.performed_on <= ?2`,
			)
			.bind(windowStart, today)
			.all<SetRow>(),
		db
			.prepare(
				`SELECT lr.distance_km, lr.duration_seconds, lr.avg_hr, lr.rpe_1_10, lr.performed_on, pr.run_type
				 FROM logged_runs lr LEFT JOIN planned_runs pr ON pr.session_id = lr.session_id
				 WHERE lr.performed_on >= ?1 AND lr.performed_on <= ?2`,
			)
			.bind(windowStart, today)
			.all<RunRow>(),
		db
			.prepare(
				`SELECT date, distance_km, result_seconds FROM races
				 WHERE result_seconds IS NOT NULL AND date >= ?1 AND date <= ?2 ORDER BY date`,
			)
			.bind(addDaysIso(today, -RACE_LOOKBACK_DAYS), today)
			.all<RaceRow>(),
	]);

	const accumulators = new Map<string, WeekAccumulator>(weekStarts.map((ws) => [ws, newAccumulator()]));

	for (const row of sessionRes.results) {
		const acc = accumulators.get(mondayOf(row.date));
		if (!acc) continue;
		if (row.origin === 'planned') {
			acc.adherence.planned += 1;
			if (row.status === 'completed') acc.adherence.completed += 1;
			if (row.status === 'skipped') acc.adherence.skipped += 1;
		}
		acc.shoulder = maxOrNull(acc.shoulder, row.shoulder_pain_0_3);
		acc.back = maxOrNull(acc.back, row.back_pain_0_3);
	}

	for (const row of setRes.results) {
		const acc = accumulators.get(mondayOf(row.performed_on));
		if (!acc) continue;
		const estimate = estimateOneRepMax(row.weight_kg, row.reps);
		const lift = acc.lifts.get(row.exercise_id) ?? { exercise_id: row.exercise_id, name: row.name, best: 0, top: 0 };
		lift.best = Math.max(lift.best, estimate);
		lift.top = Math.max(lift.top, row.weight_kg);
		acc.lifts.set(row.exercise_id, lift);
		if (row.rir <= HARD_SET_MAX_RIR) {
			acc.hardByPattern.set(row.pattern, (acc.hardByPattern.get(row.pattern) ?? 0) + 1);
		}
	}

	for (const row of runRes.results) {
		const acc = accumulators.get(mondayOf(row.performed_on));
		if (!acc) continue;
		acc.km += row.distance_km;
		acc.runs += 1;
		acc.longRunKm = Math.max(acc.longRunKm, row.distance_km);
		if (row.rpe_1_10 !== null) {
			acc.rpeSum += row.rpe_1_10;
			acc.rpeCount += 1;
		}
		if (row.avg_hr !== null) {
			acc.hrSum += row.avg_hr;
			acc.hrCount += 1;
		}
	}

	const weekSummaries: WeekSummary[] = weekStarts.map((weekStart) => {
		const acc = accumulators.get(weekStart)!;
		const exercises: WeekExerciseLift[] = [...acc.lifts.values()]
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((l) => ({ exercise_id: l.exercise_id, name: l.name, best_e1rm_kg: round1(l.best), top_weight_kg: round1(l.top) }));
		const hardSetsByPattern = Object.fromEntries([...acc.hardByPattern.entries()].sort(([a], [b]) => a.localeCompare(b)));
		return {
			week_start: weekStart,
			is_current: weekStart === currentWeekStart,
			adherence: { ...acc.adherence },
			lifting: { exercises, hard_sets_by_pattern: hardSetsByPattern },
			running: {
				km: round1(acc.km),
				runs: acc.runs,
				long_run_km: round1(acc.longRunKm),
				avg_rpe: acc.rpeCount > 0 ? round1(acc.rpeSum / acc.rpeCount) : null,
				avg_hr: acc.hrCount > 0 ? round1(acc.hrSum / acc.hrCount) : null,
			},
			pain: { max_shoulder: acc.shoulder, max_back: acc.back },
		};
	});

	// Exercise e1RM trend: first and last week with a logged set for each.
	const seriesById = new Map<number, { name: string; points: { week: string; e1rm: number }[] }>();
	for (const week of weekSummaries) {
		for (const lift of week.lifting.exercises) {
			const series = seriesById.get(lift.exercise_id) ?? { name: lift.name, points: [] };
			series.points.push({ week: week.week_start, e1rm: lift.best_e1rm_kg });
			seriesById.set(lift.exercise_id, series);
		}
	}
	const exerciseTrends: ExerciseTrend[] = [...seriesById.entries()]
		.map(([exerciseId, { name, points }]) => {
			const first = points[0];
			const last = points[points.length - 1];
			const multiWeek = points.length > 1;
			const changeKg = multiWeek ? round1(last.e1rm - first.e1rm) : null;
			return {
				exercise_id: exerciseId,
				name,
				first_week: first.week,
				last_week: last.week,
				first_e1rm_kg: first.e1rm,
				last_e1rm_kg: last.e1rm,
				change_kg: changeKg,
				change_pct: changeKg === null ? null : percentChange(first.e1rm, last.e1rm),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	// Weekly km trend uses full weeks only (the current week is still in progress).
	const fullWeeks = weekSummaries.filter((w) => !w.is_current);
	let weeklyKm: WeeklyKmTrend | null = null;
	if (fullWeeks.length >= 2) {
		const first = fullWeeks[0];
		const last = fullWeeks[fullWeeks.length - 1];
		weeklyKm = {
			first_week: first.week_start,
			last_week: last.week_start,
			first_km: first.running.km,
			last_km: last.running.km,
			change_km: round1(last.running.km - first.running.km),
			change_pct: percentChange(first.running.km, last.running.km),
		};
	}

	const totals = weekSummaries.reduce(
		(sum, w) => ({
			planned: sum.planned + w.adherence.planned,
			completed: sum.completed + w.adherence.completed,
		}),
		{ planned: 0, completed: 0 },
	);

	return {
		today,
		window_start: windowStart,
		current_week_start: currentWeekStart,
		weeks: weekSummaries,
		trends: {
			exercises: exerciseTrends,
			weekly_km: weeklyKm,
			adherence_pct: totals.planned > 0 ? round1((totals.completed / totals.planned) * 100) : null,
		},
		run_fitness: buildRunFitness(runRes.results, raceRes.results, weekStarts[Math.floor(weekStarts.length / 2)]),
	};
}
