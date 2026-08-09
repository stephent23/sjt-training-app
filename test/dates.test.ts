import { describe, expect, it } from 'vitest';
import { todayIso, weekStartOnOrAfter } from '../src/dates';

describe('todayIso', () => {
	it('returns a YYYY-MM-DD formatted string', () => {
		expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('matches the Europe/London calendar date computed independently via Intl', () => {
		// Deliberately re-derive the expected value through the same
		// Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }) mechanism
		// rather than new Date().getFullYear()/getMonth()/getDate(). Those naive
		// accessors reflect the *runtime's* local timezone, which is only
		// Europe/London by coincidence on a developer's UK machine — a
		// Cloudflare Worker's Date is always UTC-local, so getFullYear() etc.
		// would quietly give the wrong day server-side (e.g. right after 23:00
		// GMT / 00:00 BST) even though this exact test would still pass when
		// run on a UK machine. Formatting through the explicit IANA zone is
		// what actually makes this correct in both runtimes — don't "simplify"
		// this back to getFullYear/getMonth/getDate.
		const expected = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/London',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
		}).format(new Date());
		expect(todayIso()).toBe(expected);
	});

	it('formats using en-CA ordering (YYYY-MM-DD), not en-GB (DD/MM/YYYY)', () => {
		// Locale-format correctness isn't obvious from the type signature alone —
		// pin it down explicitly so a locale typo doesn't silently reorder the
		// segments.
		expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(todayIso().split('-')[0].length).toBe(4);
	});
});

describe('weekStartOnOrAfter', () => {
	// 2026-08-03 is a Monday; the rest of these hang off it.
	it('returns a Monday unchanged', () => {
		expect(weekStartOnOrAfter('2026-08-03')).toBe('2026-08-03');
	});

	it('moves a mid-week date forward to the next Monday', () => {
		expect(weekStartOnOrAfter('2026-08-04')).toBe('2026-08-10'); // Tuesday
		expect(weekStartOnOrAfter('2026-08-08')).toBe('2026-08-10'); // Saturday
	});

	it('treats Sunday as the day before a Monday, not the start of its own week', () => {
		// The one case an off-by-one gets wrong: JS getUTCDay() calls Sunday 0,
		// so a naive (1 - weekday) would send it *back* six days.
		expect(weekStartOnOrAfter('2026-08-09')).toBe('2026-08-10');
	});

	it('crosses a year boundary', () => {
		expect(weekStartOnOrAfter('2026-12-29')).toBe('2027-01-04'); // Tuesday -> Monday
	});

	it('always lands on a Monday, on or after the input', () => {
		let date = '2026-01-01';
		for (let i = 0; i < 40; i++) {
			const start = weekStartOnOrAfter(date);
			expect(start >= date).toBe(true);
			expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(1);
			date = addDays(date, 9); // a stride that is coprime with 7, so every weekday gets hit
		}
	});
});

function addDays(dateIso: string, days: number): string {
	const [year, month, day] = dateIso.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
