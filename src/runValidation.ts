// Bounds-checking for the optional watch metrics (RUN_METRIC_FIELDS), shared
// between logging a run against a planned session (sessions.ts) and recording
// or correcting a manual run (routes/runs.ts) — one copy of the check, so the
// two routes can't quietly drift on what a plausible cadence is.

import { INTERVAL_PACE_BOUNDS, RUN_METRIC_FIELDS } from './types';

/** Returns an error message for the first present-but-out-of-bounds metric,
 * or null if every present metric is in bounds. A blank/null/undefined value
 * skips that field entirely — the metrics are all optional. */
export function validateRunMetrics(body: Record<string, unknown>): string | null {
	for (const { key, min, max, integer } of RUN_METRIC_FIELDS) {
		const value = body[key];
		if (value === null || value === undefined) continue;
		if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
			return `invalid ${key}`;
		}
	}
	return null;
}

/** Same shape as validateRunMetrics but for interval_pace_seconds_per_km,
 * which isn't part of RUN_METRIC_FIELDS — it's built from two sub-fields
 * (minutes/seconds) client-side, like duration, rather than one plain number
 * input, so it doesn't fit that array's one-input-per-field contract. The
 * bounds check itself is identical: optional, whole seconds, generous range. */
export function validateIntervalPace(body: Record<string, unknown>): string | null {
	const value = body.interval_pace_seconds_per_km;
	if (value === null || value === undefined) return null;
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		!Number.isInteger(value) ||
		value < INTERVAL_PACE_BOUNDS.min ||
		value > INTERVAL_PACE_BOUNDS.max
	) {
		return 'invalid interval_pace_seconds_per_km';
	}
	return null;
}
