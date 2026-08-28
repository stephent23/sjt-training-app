// Bounds-checking for the optional watch metrics (RUN_METRIC_FIELDS), shared
// between logging a run against a planned session (sessions.ts) and recording
// or correcting a manual run (routes/runs.ts) — one copy of the check, so the
// two routes can't quietly drift on what a plausible cadence is.

import { RUN_METRIC_FIELDS } from './types';

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
