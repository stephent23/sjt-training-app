import { describe, expect, it } from 'vitest';
import { formatDuration, formatPace, loggedRunSummary, runSummary } from '../../src/client/format';

describe('formatDuration', () => {
	it('formats under an hour as m:ss', () => {
		expect(formatDuration(1830)).toBe('30:30');
		expect(formatDuration(65)).toBe('1:05');
	});

	it('formats an hour or more as h:mm:ss', () => {
		expect(formatDuration(3600)).toBe('1:00:00');
		expect(formatDuration(3725)).toBe('1:02:05');
	});

	it('pads the seconds, never the leading unit', () => {
		expect(formatDuration(9)).toBe('0:09');
	});
});

describe('formatPace', () => {
	it('gives minutes per kilometre', () => {
		expect(formatPace(10, 3000)).toBe('5:00 /km');
		expect(formatPace(8.2, 2530)).toBe('5:09 /km');
	});

	// A run logged with a distance of zero would divide by zero and render
	// "Infinity /km"; the app already refuses to commit one, but this is the
	// display layer and it should not depend on that.
	it('returns null rather than dividing by zero', () => {
		expect(formatPace(0, 1800)).toBeNull();
		expect(formatPace(5, 0)).toBeNull();
	});

	it('rolls 60 seconds up into the minute rather than printing :60', () => {
		// 5.999... min/km must read 6:00, not 5:60.
		expect(formatPace(1, 359.7)).toBe('6:00 /km');
	});
});

describe('loggedRunSummary', () => {
	it('reads distance, time and pace', () => {
		expect(loggedRunSummary(8.2, 2530)).toBe('8.2 km · 42:10 · 5:09 /km');
	});

	it('drops the pace when it cannot be computed', () => {
		expect(loggedRunSummary(0, 1800)).toBe('0 km · 30:00');
	});
});

describe('runSummary', () => {
	it('still summarises a prescription', () => {
		expect(runSummary('easy', 40, 8)).toBe('Easy · 40 min · 8 km');
	});
});
