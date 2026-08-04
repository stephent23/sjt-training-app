// Display-formatting helpers shared across screens. Each of these existed as
// a private copy in two-to-four files before.

/** "easy" -> "Easy". Used for run types and session statuses, which are stored
 * lowercase but always shown capitalised. */
export function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The one-line summary of a run prescription, e.g. "Easy · 40 min · 8 km".
 * Minutes and km are both optional and either can be absent. */
export function runSummary(runType: string, targetMinutes: number | null, targetKm: number | null): string {
	const parts = [capitalize(runType)];
	if (targetMinutes) parts.push(`${targetMinutes} min`);
	if (targetKm) parts.push(`${targetKm} km`);
	return parts.join(' · ');
}
