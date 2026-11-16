import { daysBetweenIso } from './dates';
import type { Race } from './types';

// What the plan-writer needs to know about races, derived from the races table.
// Pure so it can be tested without a database; the route reads the rows.

export interface UpcomingRace {
	name: string;
	date: string;
	distance_km: number;
	priority: 'A' | 'B';
	target_seconds: number | null;
	/** Derived; null without a target. */
	target_pace_seconds_per_km: number | null;
	days_until: number;
	weeks_until: number;
	/** 1..N week of this block the race falls in; null before or after it. */
	block_week: number | null;
}

export interface RaceResult {
	date: string;
	name: string;
	distance_km: number;
	result_seconds: number;
	pace_seconds_per_km: number;
}

export interface PersonalBest {
	distance_km: number;
	result_seconds: number;
	pace_seconds_per_km: number;
	date: string;
	name: string;
}

export interface RaceContext {
	races: UpcomingRace[];
	raceResults: RaceResult[];
	personalBests: PersonalBest[];
	/** Past races with no result recorded: informational ("raced, time not recorded"). */
	racesWithoutTime: { name: string; date: string; distance_km: number }[];
}

const pace = (seconds: number, km: number) => Math.round(seconds / km);

export function buildRaceContext(rows: Race[], today: string, block?: { startDate: string; weeks: number }): RaceContext {
	const upcoming = rows
		.filter((r) => r.date >= today && r.result_seconds === null)
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((r): UpcomingRace => {
			const days = daysBetweenIso(today, r.date);
			const week = block ? Math.floor(daysBetweenIso(block.startDate, r.date) / 7) + 1 : 0;
			return {
				name: r.name,
				date: r.date,
				distance_km: r.distance_km,
				priority: r.priority,
				target_seconds: r.target_seconds,
				target_pace_seconds_per_km: r.target_seconds === null ? null : pace(r.target_seconds, r.distance_km),
				days_until: days,
				weeks_until: Math.floor(days / 7),
				block_week: week >= 1 && block && week <= block.weeks ? week : null,
			};
		});

	const done = rows
		.filter((r): r is Race & { result_seconds: number } => r.result_seconds !== null)
		.sort((a, b) => b.date.localeCompare(a.date));

	const raceResults = done.map((r): RaceResult => ({
		date: r.date,
		name: r.name,
		distance_km: r.distance_km,
		result_seconds: r.result_seconds,
		pace_seconds_per_km: pace(r.result_seconds, r.distance_km),
	}));

	// A half typed as 21.0975 and one picked as 21.1 are the same distance: compare per 0.1 km.
	const best = new Map<number, (typeof raceResults)[number]>();
	for (const r of raceResults) {
		const key = Math.round(r.distance_km * 10);
		const current = best.get(key);
		if (!current || r.result_seconds < current.result_seconds) best.set(key, r);
	}
	const personalBests = [...best.values()]
		.sort((a, b) => a.distance_km - b.distance_km)
		.map((r): PersonalBest => ({ distance_km: r.distance_km, result_seconds: r.result_seconds, pace_seconds_per_km: r.pace_seconds_per_km, date: r.date, name: r.name }));

	const racesWithoutTime = rows
		.filter((r) => r.date < today && r.result_seconds === null)
		.sort((a, b) => b.date.localeCompare(a.date))
		.map((r) => ({ name: r.name, date: r.date, distance_km: r.distance_km }));

	return { races: upcoming, raceResults, personalBests, racesWithoutTime };
}
