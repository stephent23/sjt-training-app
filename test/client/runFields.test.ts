import { describe, expect, it } from 'vitest';
import { emptyRunFields, parseRunFields, runFieldsFrom } from '../../src/client/runFields';
import { RUN_METRIC_FIELDS, type LoggedRunEntry } from '../../src/types';

// The string-state ↔ numbers logic lifted out of ReviewRun so the run editor
// and the review screen can't disagree about what a valid run is. ReviewRun
// only ever refused to commit; the extracted version has to say *why*, because
// a dedicated editor that silently does nothing when you press Save is worse
// than one that refuses out loud.

type Fields = Record<string, string>;

const metricKeys = RUN_METRIC_FIELDS.map((f) => f.key);

function fields(overrides: Fields = {}): Fields {
	return { ...emptyRunFields(), ...overrides };
}

/** Both branches of the result are useful to assert on, and TypeScript needs
 *  the narrowing; these also make a failure report the reasons rather than
 *  "expected true, got false". */
function ok(result: ReturnType<typeof parseRunFields>) {
	if (!result.ok) throw new Error(`expected a parse, got errors: ${result.errors.join(' | ')}`);
	return result.value;
}

function failed(result: ReturnType<typeof parseRunFields>): string[] {
	if (result.ok) throw new Error(`expected a failure, got: ${JSON.stringify(result.value)}`);
	return result.errors;
}

function loggedRun(overrides: Partial<LoggedRunEntry> = {}): LoggedRunEntry {
	return {
		distance_km: 12.5,
		duration_seconds: 3930, // 65:30
		avg_hr: 148,
		max_hr: null,
		avg_cadence_spm: null,
		elevation_gain_m: 0,
		aerobic_training_effect: null,
		rpe_1_10: null,
		performed_on: '2026-08-10',
		note: 'Felt strong',
		...overrides,
	};
}

describe('emptyRunFields', () => {
	it('has a blank string for every field the form owns', () => {
		const empty = emptyRunFields();

		expect(Object.keys(empty).sort()).toEqual(['distance', 'minutes', 'seconds', 'note', ...metricKeys].sort());
		expect(Object.values(empty).every((v) => v === '')).toBe(true);
	});
});

describe('runFieldsFrom', () => {
	it('is the empty form when there is nothing logged yet', () => {
		expect(runFieldsFrom(null)).toEqual(emptyRunFields());
	});

	it('splits the stored duration back into minutes and seconds', () => {
		const f = runFieldsFrom(loggedRun());

		expect(f.distance).toBe('12.5');
		expect(f.minutes).toBe('65');
		expect(f.seconds).toBe('30');
	});

	it('shows a missing metric as blank and a zero one as zero', () => {
		const f = runFieldsFrom(loggedRun());

		// The distinction the whole null-vs-0 rule exists for: 0 m of climb is a
		// fact about the run, an unrecorded HR is not.
		expect(f.elevation_gain_m).toBe('0');
		expect(f.max_hr).toBe('');
		expect(f.avg_hr).toBe('148');
	});

	it('shows an absent note as blank rather than "null"', () => {
		expect(runFieldsFrom(loggedRun({ note: null })).note).toBe('');
	});

	it('round-trips a logged run back to the same numbers', () => {
		const entry = loggedRun();

		expect(ok(parseRunFields(runFieldsFrom(entry)))).toEqual({
			distance_km: 12.5,
			duration_seconds: 3930,
			note: 'Felt strong',
			avg_hr: 148,
			max_hr: null,
			avg_cadence_spm: null,
			elevation_gain_m: 0,
			aerobic_training_effect: null,
			rpe_1_10: null,
		});
	});
});

describe('parseRunFields — distance and duration', () => {
	it('folds minutes and seconds into one duration', () => {
		expect(ok(parseRunFields(fields({ distance: '8.2', minutes: '42', seconds: '30' }))).duration_seconds).toBe(2550);
	});

	it('treats a blank minutes or seconds as zero rather than as a problem', () => {
		expect(ok(parseRunFields(fields({ distance: '5', minutes: '30', seconds: '' }))).duration_seconds).toBe(1800);
		expect(ok(parseRunFields(fields({ distance: '0.2', minutes: '', seconds: '45' }))).duration_seconds).toBe(45);
	});

	// The rule ReviewRun enforced by refusing to commit: a run with no distance
	// or no duration still counts as "a long run was logged" to progressRun, and
	// so earns the following week's 10% growth off a junk row.
	it('rejects a distance that is missing, zero, negative or not a number', () => {
		for (const distance of ['', '0', '-3', 'abc']) {
			expect(failed(parseRunFields(fields({ distance, minutes: '30' }))).join(' ')).toMatch(/distance/i);
		}
	});

	it('rejects a duration of zero', () => {
		expect(failed(parseRunFields(fields({ distance: '8', minutes: '', seconds: '' }))).join(' ')).toMatch(/duration/i);
		expect(failed(parseRunFields(fields({ distance: '8', minutes: '0', seconds: '0' }))).join(' ')).toMatch(/duration/i);
	});
});

describe('parseRunFields — watch metrics', () => {
	const valid = { distance: '8', minutes: '40', seconds: '0' };

	it('reads a blank metric as null, never as zero', () => {
		const value = ok(parseRunFields(fields(valid)));

		for (const key of metricKeys) {
			expect(value[key]).toBeNull();
		}
	});

	it('keeps a metric that is genuinely zero', () => {
		expect(ok(parseRunFields(fields({ ...valid, elevation_gain_m: '0' }))).elevation_gain_m).toBe(0);
	});

	it('rejects a metric below its floor', () => {
		expect(failed(parseRunFields(fields({ ...valid, avg_hr: '5' }))).join(' ')).toMatch(/avg.?hr/i);
	});

	it('rejects a metric above its ceiling', () => {
		expect(failed(parseRunFields(fields({ ...valid, avg_cadence_spm: '900' }))).join(' ')).toMatch(/cadence/i);
	});

	it('rejects a fractional value in a whole-number field', () => {
		expect(failed(parseRunFields(fields({ ...valid, rpe_1_10: '7.5' }))).join(' ')).toMatch(/rpe/i);
	});

	it('allows a fractional value where the field is not a whole number', () => {
		expect(ok(parseRunFields(fields({ ...valid, aerobic_training_effect: '3.4' }))).aerobic_training_effect).toBe(3.4);
	});

	it('rejects a metric that is not a number at all', () => {
		expect(failed(parseRunFields(fields({ ...valid, max_hr: 'one fifty' }))).join(' ')).toMatch(/max.?hr/i);
	});
});

describe('parseRunFields — note', () => {
	it('stores nothing for a note that is blank or only whitespace', () => {
		expect(ok(parseRunFields(fields({ distance: '8', minutes: '40', note: '' }))).note).toBeNull();
		expect(ok(parseRunFields(fields({ distance: '8', minutes: '40', note: '   ' }))).note).toBeNull();
	});

	it('keeps a note that says something', () => {
		expect(ok(parseRunFields(fields({ distance: '8', minutes: '40', note: 'Legs heavy' }))).note).toBe('Legs heavy');
	});
});

describe('parseRunFields — reporting', () => {
	// One sentence per problem, so the editor can list them: a person who has
	// mistyped two fields should be told about both, not sent round the loop
	// twice.
	it('reports every bad field, not just the first', () => {
		const errors = failed(parseRunFields(fields({ distance: '0', minutes: '', seconds: '', avg_hr: '400' })));

		expect(errors).toHaveLength(3);
		expect(errors.join(' ')).toMatch(/distance/i);
		expect(errors.join(' ')).toMatch(/duration/i);
		expect(errors.join(' ')).toMatch(/avg.?hr/i);
	});

	it('writes sentences a person can act on rather than field codes', () => {
		for (const error of failed(parseRunFields(fields({ distance: '', minutes: '' })))) {
			expect(error.length).toBeGreaterThan(10);
			expect(error).toMatch(/\s/); // more than one word
		}
	});
});
