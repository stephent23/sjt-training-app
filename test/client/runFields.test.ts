import { describe, expect, it } from 'vitest';
import {
	autoColon,
	derivePace,
	emptyRunFields,
	parseDuration,
	parseRunFields,
	ranAsPlanned,
	runFieldsFrom,
	runPreview,
} from '../../src/client/runFields';
import { RUN_METRIC_FIELDS, type LoggedRunEntry } from '../../src/types';

// The string-state ↔ numbers logic lifted out of ReviewRun so the run editor
// and the review screen can't disagree about what a valid run is. ReviewRun
// only ever refused to commit; the extracted version has to say *why*, because
// a dedicated editor that silently does nothing when you press Save is worse
// than one that refuses out loud.
//
// Duration and interval pace are each ONE text field ("28:40", "1:02:15", or
// plain minutes) rather than separate minute/second boxes — typing two boxes
// on a phone keypad was the slow part of logging a run.

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
		duration_seconds: 3930, // 1:05:30
		avg_hr: 148,
		max_hr: null,
		avg_cadence_spm: null,
		elevation_gain_m: 0,
		aerobic_training_effect: null,
		rpe_1_10: null,
		interval_pace_seconds_per_km: null,
		performed_on: '2026-08-10',
		note: 'Felt strong',
		...overrides,
	};
}

describe('emptyRunFields', () => {
	it('has a blank string for every field the form owns', () => {
		const empty = emptyRunFields();

		expect(Object.keys(empty).sort()).toEqual(['distance', 'duration', 'pace', 'durationBy', 'intervalPace', 'note', ...metricKeys].sort());
		expect(Object.values(empty).every((v) => v === '')).toBe(true);
	});
});

describe('runFieldsFrom', () => {
	it('is the empty form when there is nothing logged yet', () => {
		expect(runFieldsFrom(null)).toEqual(emptyRunFields());
	});

	it('writes the stored duration back as one m:ss / h:mm:ss string', () => {
		const f = runFieldsFrom(loggedRun());

		expect(f.distance).toBe('12.5');
		expect(f.duration).toBe('1:05:30');
		expect(f.durationBy).toBe('duration');
		expect(runFieldsFrom(loggedRun({ duration_seconds: 1720 })).duration).toBe('28:40');
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
			interval_pace_seconds_per_km: null,
		});
	});

	it('writes a stored interval pace as m:ss, same as duration', () => {
		expect(runFieldsFrom(loggedRun({ interval_pace_seconds_per_km: 272 })).intervalPace).toBe('4:32'); // 4:32/km
	});

	it('round-trips a logged interval pace back to the same number', () => {
		const entry = loggedRun({ interval_pace_seconds_per_km: 272 });

		expect(ok(parseRunFields(runFieldsFrom(entry))).interval_pace_seconds_per_km).toBe(272);
	});
});

describe('parseRunFields — distance and duration', () => {
	it('reads one duration string as seconds', () => {
		expect(ok(parseRunFields(fields({ distance: '8.2', duration: '42:30' }))).duration_seconds).toBe(2550);
		expect(ok(parseRunFields(fields({ distance: '5', duration: '30' }))).duration_seconds).toBe(1800);
	});

	it('says what is wrong with an unreadable duration', () => {
		const errors = failed(parseRunFields(fields({ distance: '5', duration: '28:75' })));
		expect(errors.join(' ')).toMatch(/duration/i);
	});

	it('reports per-field errors so the form can put them under the field', () => {
		const result = parseRunFields(fields({ distance: '', duration: '', avg_hr: '400' }));
		if (result.ok) throw new Error('expected failure');
		expect(Object.keys(result.fieldErrors).sort()).toEqual(['avg_hr', 'distance', 'duration']);
		expect(result.fieldErrors.distance).toMatch(/distance/i);
	});

	// The rule ReviewRun enforced by refusing to commit: a run with no distance
	// or no duration still counts as "a long run was logged" to progressRun, and
	// so earns the following week's 10% growth off a junk row.
	it('rejects a distance that is missing, zero, negative or not a number', () => {
		for (const distance of ['', '0', '-3', 'abc']) {
			expect(failed(parseRunFields(fields({ distance, duration: '30' }))).join(' ')).toMatch(/distance/i);
		}
	});

	it('rejects a duration of zero', () => {
		expect(failed(parseRunFields(fields({ distance: '8', duration: '' }))).join(' ')).toMatch(/duration/i);
		expect(failed(parseRunFields(fields({ distance: '8', duration: '0:00' }))).join(' ')).toMatch(/duration/i);
	});
});

describe('parseRunFields — watch metrics', () => {
	const valid = { distance: '8', duration: '40:00' };

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

describe('parseRunFields — interval pace', () => {
	const valid = { distance: '8', duration: '40:00' };

	it('is null when blank, unlike duration it is not required', () => {
		expect(ok(parseRunFields(fields(valid))).interval_pace_seconds_per_km).toBeNull();
	});

	it('reads m:ss as whole seconds per km, and a bare number as minutes', () => {
		expect(ok(parseRunFields(fields({ ...valid, intervalPace: '4:32' }))).interval_pace_seconds_per_km).toBe(272);
		expect(ok(parseRunFields(fields({ ...valid, intervalPace: '4' }))).interval_pace_seconds_per_km).toBe(240);
	});

	it('rejects a pace below its floor', () => {
		// 1:00/km — faster than any sustained human pace, below the 90s floor.
		expect(failed(parseRunFields(fields({ ...valid, intervalPace: '1:00' }))).join(' ')).toMatch(/interval pace/i);
	});

	it('rejects a pace above its ceiling', () => {
		// 21:00/km, above the 1200s ceiling.
		expect(failed(parseRunFields(fields({ ...valid, intervalPace: '21:00' }))).join(' ')).toMatch(/interval pace/i);
	});

	it('rejects a pace that cannot be read', () => {
		expect(failed(parseRunFields(fields({ ...valid, intervalPace: 'fast' }))).join(' ')).toMatch(/interval pace/i);
	});
});

describe('parseRunFields — note', () => {
	it('stores nothing for a note that is blank or only whitespace', () => {
		expect(ok(parseRunFields(fields({ distance: '8', duration: '40', note: '' }))).note).toBeNull();
		expect(ok(parseRunFields(fields({ distance: '8', duration: '40', note: '   ' }))).note).toBeNull();
	});

	it('keeps a note that says something', () => {
		expect(ok(parseRunFields(fields({ distance: '8', duration: '40', note: 'Legs heavy' }))).note).toBe('Legs heavy');
	});
});

describe('parseRunFields — reporting', () => {
	// One sentence per problem, so the editor can list them: a person who has
	// mistyped two fields should be told about both, not sent round the loop
	// twice.
	it('reports every bad field, not just the first', () => {
		const errors = failed(parseRunFields(fields({ distance: '0', duration: '', avg_hr: '400' })));

		expect(errors).toHaveLength(3);
		expect(errors.join(' ')).toMatch(/distance/i);
		expect(errors.join(' ')).toMatch(/duration/i);
		expect(errors.join(' ')).toMatch(/avg.?hr/i);
	});

	it('writes sentences a person can act on rather than field codes', () => {
		for (const error of failed(parseRunFields(fields({ distance: '', duration: '' })))) {
			expect(error.length).toBeGreaterThan(10);
			expect(error).toMatch(/\s/); // more than one word
		}
	});
});

describe('parseDuration', () => {
	it('reads m:ss, h:mm:ss and plain minutes', () => {
		expect(parseDuration('28:40')).toBe(1720);
		expect(parseDuration('1:02:15')).toBe(3735);
		expect(parseDuration('45')).toBe(2700);
		expect(parseDuration(' 90:00 ')).toBe(5400);
		expect(parseDuration('45.5')).toBe(2730);
	});

	it('is null for blank, junk, or out-of-range parts', () => {
		for (const bad of ['', 'abc', '28:75', '1:75:00', '1:2:3:4', ':30', '-5', '28:']) {
			expect(parseDuration(bad)).toBeNull();
		}
	});
});

describe('autoColon', () => {
	it('leaves one or two digits alone — those are plain minutes', () => {
		expect(autoColon('4')).toBe('4');
		expect(autoColon('45')).toBe('45');
	});

	it('inserts colons from the right as digits are typed', () => {
		expect(autoColon('945')).toBe('9:45');
		expect(autoColon('2840')).toBe('28:40');
		expect(autoColon('10215')).toBe('1:02:15');
		expect(autoColon('102215')).toBe('10:22:15');
	});

	it('keeps whatever a person who types colons themselves wrote, minus junk', () => {
		expect(autoColon('28:4')).toBe('28:4');
		expect(autoColon('28:40 min')).toBe('28:40');
	});
});

describe('pace and duration derive each other', () => {
	it('derivePace gives seconds per km, rounded', () => {
		expect(derivePace(5.2, 1720)).toBe(331);
		expect(derivePace(0, 1720)).toBeNull();
		expect(derivePace(5, 0)).toBeNull();
	});

	it('a typed pace becomes the duration, distance times pace', () => {
		const value = ok(parseRunFields(fields({ distance: '10', durationBy: 'pace', pace: '5:30' })));
		expect(value.duration_seconds).toBe(3300);
	});

	it('shows the duration as derived when pace was what was typed, and vice versa', () => {
		const byPace = runPreview(fields({ distance: '10', durationBy: 'pace', pace: '5:30' }));
		expect(byPace.duration).toBe('55:00');
		expect(byPace.pace).toBe('5:30');

		const byDuration = runPreview(fields({ distance: '5.2', duration: '28:40' }));
		expect(byDuration.duration).toBe('28:40');
		expect(byDuration.pace).toBe('5:31');
		expect(byDuration.summary).toBe('5.2 km · 28:40 · 5:31 /km');
	});

	it('has no preview until it has something to say', () => {
		expect(runPreview(fields()).summary).toBe('');
		expect(runPreview(fields({ distance: '5' })).summary).toBe('5 km');
	});

	it('requires a readable pace when pace is the entry mode', () => {
		const errors = failed(parseRunFields(fields({ distance: '10', durationBy: 'pace', pace: '' })));
		expect(errors.join(' ')).toMatch(/duration/i);
	});
});

describe('ranAsPlanned', () => {
	it('fills distance from the target and leaves duration for the person', () => {
		const f = ranAsPlanned(fields(), { target_km: 8, target_minutes: 50 });
		expect(f.distance).toBe('8');
		expect(f.duration).toBe('');
	});

	it('falls back to the target minutes as the duration when there is no target distance', () => {
		const f = ranAsPlanned(fields(), { target_km: null, target_minutes: 40 });
		expect(f.distance).toBe('');
		expect(f.duration).toBe('40:00');
		expect(f.durationBy).toBe('duration');
	});

	it('keeps everything else already typed', () => {
		const f = ranAsPlanned(fields({ note: 'hi' }), { target_km: 5, target_minutes: null });
		expect(f.note).toBe('hi');
	});
});
