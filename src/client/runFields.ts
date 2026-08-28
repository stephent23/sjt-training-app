// The string-state <-> numbers logic behind the run-logging form, shared by
// Review's inline editor and the standalone RunEditor screen so the two can't
// disagree about what a valid run is. See RUN_METRIC_FIELDS in ../types for
// the bounds enforced below.

import { RUN_METRIC_FIELDS, type LoggedRunEntry, type RunMetricField } from '../types';

export type RunFields = Record<string, string>;

export function emptyRunFields(): RunFields {
	return {
		distance: '',
		minutes: '',
		seconds: '',
		note: '',
		...Object.fromEntries(RUN_METRIC_FIELDS.map((f) => [f.key, ''])),
	};
}

export function runFieldsFrom(loggedRun: LoggedRunEntry | null): RunFields {
	if (!loggedRun) return emptyRunFields();

	return {
		distance: String(loggedRun.distance_km),
		minutes: String(Math.floor(loggedRun.duration_seconds / 60)),
		seconds: String(loggedRun.duration_seconds % 60),
		note: loggedRun.note ?? '',
		...Object.fromEntries(RUN_METRIC_FIELDS.map((f) => [f.key, loggedRun[f.key] == null ? '' : String(loggedRun[f.key])])),
	};
}

type ParsedRun = Pick<LoggedRunEntry, 'distance_km' | 'duration_seconds' | 'note'> & Record<RunMetricField, number | null>;

export type ParseRunFieldsResult = { ok: true; value: ParsedRun } | { ok: false; errors: string[] };

/** A run is only worth writing once BOTH distance and duration are real —
 * otherwise filling in the first field alone would log a run with duration 0
 * (or distance 0), which is not just cosmetic: progressRun only checks
 * whether a long run was logged at all, so a junk row counts as a real one
 * and earns the following week's 10% growth off it. */
export function parseRunFields(fields: RunFields): ParseRunFieldsResult {
	const errors: string[] = [];

	const distanceKm = Number(fields.distance);
	if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
		errors.push('Distance must be a number greater than zero.');
	}

	const durationSeconds = (Number(fields.minutes) || 0) * 60 + (Number(fields.seconds) || 0);
	if (durationSeconds <= 0) {
		errors.push('Duration must add up to more than zero.');
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
			errors.push(`${field.label} doesn't look right — check the value you entered.`);
			continue;
		}
		metrics[field.key] = value;
	}

	if (errors.length > 0) return { ok: false, errors };

	const note = fields.note.trim() === '' ? null : fields.note;

	return {
		ok: true,
		value: {
			distance_km: distanceKm,
			duration_seconds: durationSeconds,
			note,
			...metrics,
		},
	};
}
