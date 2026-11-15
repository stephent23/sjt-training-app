// The string-state <-> numbers logic behind the run-logging form, shared by
// Review's inline editor and the standalone RunEditor screen so the two can't
// disagree about what a valid run is. See RUN_METRIC_FIELDS in ../types for
// the bounds enforced below.
//
// Duration and pace are single text fields ("28:40", "1:02:15", or plain
// minutes). Exactly one of duration/pace is the person's entry (`durationBy`);
// the other is derived from distance and shown, never stored.

import { INTERVAL_PACE_BOUNDS, RUN_METRIC_FIELDS, type LoggedRunEntry, type RunMetricField } from '../types';
import { formatDuration } from './format';

export type RunFields = Record<string, string>;

export function emptyRunFields(): RunFields {
	return {
		distance: '',
		duration: '',
		pace: '',
		// '' means 'duration' — which of duration/pace the person typed.
		durationBy: '',
		intervalPace: '',
		note: '',
		...Object.fromEntries(RUN_METRIC_FIELDS.map((f) => [f.key, ''])),
	};
}

export function runFieldsFrom(loggedRun: LoggedRunEntry | null): RunFields {
	if (!loggedRun) return emptyRunFields();

	const pace = loggedRun.interval_pace_seconds_per_km;

	return {
		distance: String(loggedRun.distance_km),
		duration: formatDuration(loggedRun.duration_seconds),
		pace: '',
		durationBy: 'duration',
		intervalPace: pace == null ? '' : formatDuration(pace),
		note: loggedRun.note ?? '',
		...Object.fromEntries(RUN_METRIC_FIELDS.map((f) => [f.key, loggedRun[f.key] == null ? '' : String(loggedRun[f.key])])),
	};
}

/** "28:40" -> 1720, "1:02:15" -> 3735, "45" -> 2700 (a bare number is minutes).
 * Null for blank or anything unreadable, including minutes/seconds of 60+ in a
 * colon form ("28:75"). */
export function parseDuration(text: string): number | null {
	const t = text.trim();
	if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60);
	const parts = t.split(':');
	if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
	const nums = parts.map(Number);
	const rest = nums.slice(1);
	if (rest.some((n) => n >= 60) || parts.slice(1).some((p) => p.length > 2)) return null;
	return nums.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2];
}

/** A pace is m:ss per km; a bare number is minutes. No hours form. */
export function parsePace(text: string): number | null {
	if (text.split(':').length > 2) return null;
	return parseDuration(text);
}

/** Keeps a numeric keypad usable for duration entry: the digits are grouped
 * from the right on every keystroke, so "2840" shows as 28:40 and "10215" as
 * 1:02:15. One or two digits stay plain minutes. Colons typed by hand are
 * ignored — the grouping supplies them. */
export function autoColon(raw: string): string {
	// Always regroup from the digits alone. The field's own value already holds
	// the colons this function put in, so treating "has a colon" as "typed by
	// hand, leave it" froze the grouping after the third digit: 2840 came out
	// as 2:840. Six digits (h:mm:ss up to 99:59:59) is the most a time needs.
	const cleaned = raw.replace(/\D/g, '').slice(0, 6);
	if (cleaned.length <= 2) return cleaned;
	const secs = cleaned.slice(-2);
	const mins = cleaned.slice(-4, -2);
	const hours = cleaned.slice(0, -4);
	return hours ? `${hours}:${mins}:${secs}` : `${mins}:${secs}`;
}

/** Seconds per km, rounded to whole seconds; null when there is nothing to divide. */
export function derivePace(distanceKm: number, durationSeconds: number): number | null {
	if (!(distanceKm > 0) || !(durationSeconds > 0)) return null;
	return Math.round(durationSeconds / distanceKm);
}

function paceInPaceMode(fields: RunFields): boolean {
	return fields.durationBy === 'pace';
}

/** The duration the form currently means, from whichever of duration/pace was
 * typed. Null when it can't be worked out (yet). */
function effectiveDuration(fields: RunFields): number | null {
	if (paceInPaceMode(fields)) {
		const pace = parsePace(fields.pace);
		const distance = Number(fields.distance);
		if (pace == null || !(pace > 0) || !(distance > 0)) return null;
		const seconds = Math.round(distance * pace);
		return seconds > 0 ? seconds : null;
	}
	return parseDuration(fields.duration);
}

export interface RunPreview {
	/** Formatted duration, typed or derived ('' when unknown). */
	duration: string;
	/** Formatted pace m:ss, typed or derived ('' when unknown). */
	pace: string;
	/** "5.2 km · 28:40 · 5:31 /km" — only the parts that are known. */
	summary: string;
}

export function runPreview(fields: RunFields): RunPreview {
	const distance = Number(fields.distance);
	const km = distance > 0 ? distance : null;
	const seconds = effectiveDuration(fields);
	const duration = seconds != null && seconds > 0 ? formatDuration(seconds) : '';

	let paceSeconds: number | null;
	if (paceInPaceMode(fields)) {
		paceSeconds = parsePace(fields.pace);
	} else {
		paceSeconds = km != null && seconds ? derivePace(km, seconds) : null;
	}
	const pace = paceSeconds ? formatDuration(paceSeconds) : '';

	const parts: string[] = [];
	if (km != null) parts.push(`${km} km`);
	if (duration) parts.push(duration);
	if (pace && km != null && duration) parts.push(`${pace} /km`);
	return { duration, pace, summary: parts.join(' · ') };
}

/** One tap for the run that went to plan: distance from the target, leaving
 * duration (the number the person actually has to read off the watch) empty.
 * A plan with only a time target prefills the duration instead. */
export function ranAsPlanned(fields: RunFields, planned: { target_km: number | null; target_minutes: number | null }): RunFields {
	if (planned.target_km) return { ...fields, distance: String(planned.target_km) };
	if (planned.target_minutes) return { ...fields, duration: formatDuration(planned.target_minutes * 60), durationBy: 'duration' };
	return fields;
}

type ParsedRun = Pick<LoggedRunEntry, 'distance_km' | 'duration_seconds' | 'note' | 'interval_pace_seconds_per_km'> &
	Record<RunMetricField, number | null>;

export type ParseRunFieldsResult =
	| { ok: true; value: ParsedRun }
	| { ok: false; errors: string[]; fieldErrors: Record<string, string> };

/** A run is only worth writing once BOTH distance and duration are real —
 * otherwise filling in the first field alone would log a run with duration 0
 * (or distance 0), which is not just cosmetic: progressRun only checks
 * whether a long run was logged at all, so a junk row counts as a real one
 * and earns the following week's 10% growth off it. */
export function parseRunFields(fields: RunFields): ParseRunFieldsResult {
	const errors: string[] = [];
	const fieldErrors: Record<string, string> = {};
	const fail = (key: string, message: string) => {
		errors.push(message);
		fieldErrors[key] = message;
	};

	const distanceKm = Number(fields.distance);
	const distanceOk = fields.distance.trim() !== '' && Number.isFinite(distanceKm) && distanceKm > 0;
	if (!distanceOk) fail('distance', 'Distance must be a number greater than zero.');

	let durationSeconds = 0;
	if (paceInPaceMode(fields)) {
		const pace = parsePace(fields.pace);
		if (fields.pace.trim() === '') {
			fail('pace', 'Duration comes from distance and pace — enter a pace like 5:30.');
		} else if (pace == null || pace < INTERVAL_PACE_BOUNDS.min || pace > INTERVAL_PACE_BOUNDS.max) {
			fail('pace', "Pace doesn't look right — try something like 5:30 per km.");
		} else if (distanceOk) {
			durationSeconds = effectiveDuration(fields) ?? 0;
			if (durationSeconds <= 0) fail('pace', 'Duration must add up to more than zero.');
		}
	} else {
		const parsed = parseDuration(fields.duration);
		if (fields.duration.trim() !== '' && parsed == null) {
			fail('duration', 'Duration should look like 28:40, 1:02:15, or plain minutes.');
		} else if (parsed == null || parsed <= 0) {
			fail('duration', 'Duration must add up to more than zero.');
		} else {
			durationSeconds = parsed;
		}
	}

	// Unlike duration, interval pace is entirely optional — blank means "not
	// applicable" (easy/long runs have no work segment to average one over),
	// not zero.
	let intervalPaceSecondsPerKm: number | null = null;
	if (fields.intervalPace.trim() !== '') {
		const pace = parsePace(fields.intervalPace);
		if (pace == null || pace < INTERVAL_PACE_BOUNDS.min || pace > INTERVAL_PACE_BOUNDS.max) {
			fail('intervalPace', "Interval pace doesn't look right — check the value you entered.");
		} else {
			intervalPaceSecondsPerKm = pace;
		}
	}

	const metrics = {} as Record<RunMetricField, number | null>;
	for (const field of RUN_METRIC_FIELDS) {
		const raw = fields[field.key] ?? '';
		if (raw.trim() === '') {
			metrics[field.key] = null;
			continue;
		}
		const value = Number(raw);
		const outOfRange = !Number.isFinite(value) || value < field.min || value > field.max;
		const notWhole = field.integer && !Number.isInteger(value);
		if (outOfRange || notWhole) {
			fail(field.key, `${field.label} doesn't look right — check the value you entered.`);
			continue;
		}
		metrics[field.key] = value;
	}

	if (errors.length > 0) return { ok: false, errors, fieldErrors };

	const note = fields.note.trim() === '' ? null : fields.note;

	return {
		ok: true,
		value: {
			distance_km: distanceKm,
			duration_seconds: durationSeconds,
			interval_pace_seconds_per_km: intervalPaceSecondsPerKm,
			note,
			...metrics,
		},
	};
}
