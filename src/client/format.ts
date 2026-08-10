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

/** Seconds as m:ss, or h:mm:ss once it runs past the hour. */
export function formatDuration(totalSeconds: number): string {
	const seconds = Math.round(totalSeconds);
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = String(seconds % 60).padStart(2, '0');
	return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/** Minutes per kilometre, e.g. "5:09 /km". Derived rather than stored — a
 * stored copy would be a second thing to keep in step with distance and
 * duration. Null when there is nothing to divide, so the display layer doesn't
 * depend on the logging rules that normally prevent it. */
export function formatPace(distanceKm: number, durationSeconds: number): string | null {
	if (!(distanceKm > 0) || !(durationSeconds > 0)) return null;
	// Round to whole seconds *before* splitting, so 359.7s/km reads 6:00 rather
	// than 5:60.
	const secondsPerKm = Math.round(durationSeconds / distanceKm);
	return `${Math.floor(secondsPerKm / 60)}:${String(secondsPerKm % 60).padStart(2, '0')} /km`;
}

/** What a run actually was, for list and history rows that previously showed
 * only what had been planned — a finished run looked identical to an unstarted
 * one. */
export function loggedRunSummary(distanceKm: number, durationSeconds: number): string {
	const pace = formatPace(distanceKm, durationSeconds);
	const parts = [`${distanceKm} km`, formatDuration(durationSeconds)];
	if (pace) parts.push(pace);
	return parts.join(' · ');
}
