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
