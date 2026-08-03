import { describe, expect, it } from 'vitest';
import { todayIso } from '../src/dates';

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
