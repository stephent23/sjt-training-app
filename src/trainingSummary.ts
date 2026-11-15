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

/** Sets with this many reps in reserve or fewer count as hard. */
const HARD_SET_MAX_RIR = 3;

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
	avg_hr: number | null;
	rpe_1_10: number | null;
	performed_on: string;
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
 * Three bulk reads (sessions with their feedback, logged sets, logged runs)
 * over the window, aggregated in memory. Single-user data, so a few hundred
 * rows at most; per-week queries would only add round trips.
 */
export async function buildTrainingSummary(db: D1Database, today: string, weeks = 12): Promise<TrainingSummary> {
	const currentWeekStart = mondayOf(today);
	const windowStart = addDaysIso(currentWeekStart, -7 * weeks);
	const weekStarts = Array.from({ length: weeks + 1 }, (_, i) => addDaysIso(windowStart, 7 * i));

	const [sessionRes, setRes, runRes] = await Promise.all([
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
				`SELECT distance_km, avg_hr, rpe_1_10, performed_on FROM logged_runs
				 WHERE performed_on >= ?1 AND performed_on <= ?2`,
			)
			.bind(windowStart, today)
			.all<RunRow>(),
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
	};
}
