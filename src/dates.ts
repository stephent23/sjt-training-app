// Shared date helpers — imported by both the Worker routes and the Preact
// client (same pattern as src/types.ts).

/** Today's date as YYYY-MM-DD in Europe/London, regardless of the runtime's
 * own timezone — Cloudflare Workers always run with UTC as their local
 * timezone, so naive Date accessors (getFullYear/getMonth/getDate) would
 * silently stay wrong there even though they're correct in a UK browser.
 * Using an explicit IANA zone here makes the result correct in both the
 * Worker and the client, and correct across the GMT/BST transition. */
export function todayIso(): string {
	return new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/London',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date());
}

/** The Monday on or after `dateIso` — where a plan written from scratch should
 * start. Same UTC-millis arithmetic as addDaysIso below, for the same reason.
 *
 * `(8 - weekday) % 7` rather than the more obvious `1 - weekday`: getUTCDay()
 * numbers Sunday as 0, so the naive form sends a Sunday six days *backwards*
 * into the week that has already happened. Adding 8 first keeps every offset
 * non-negative — Monday maps to 0, Sunday to 1. */
export function weekStartOnOrAfter(dateIso: string): string {
	const [year, month, day] = dateIso.split('-').map(Number);
	const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
	return addDaysIso(dateIso, (8 - weekday) % 7);
}

/** Pure calendar-day offset on a YYYY-MM-DD string — used by the generator to
 * shift last week's sessions forward by 7 days. Deliberately does the
 * arithmetic via UTC millis on the date parts (not a timezone-aware Date),
 * since a plain "YYYY-MM-DD" has no timezone of its own — treating it as a
 * calendar date and shifting by whole days avoids any DST-transition surprise
 * that constructing a local Date from the string could introduce. */
export function addDaysIso(dateIso: string, days: number): string {
	const [year, month, day] = dateIso.split('-').map(Number);
	const shifted = new Date(Date.UTC(year, month - 1, day + days));
	const yyyy = String(shifted.getUTCFullYear()).padStart(4, '0');
	const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(shifted.getUTCDate()).padStart(2, '0');
	return `${yyyy}-${mm}-${dd}`;
}
