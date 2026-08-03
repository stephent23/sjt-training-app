// Monday-first week containing the given ISO date, as 7 ISO date strings.
// Pure and DOM-free (no jsdom needed) so it can be tested the same way as
// src/dates.ts and src/setDefaults.ts.
export function weekDatesFor(dateIso: string): string[] {
	const [y, m, d] = dateIso.split('-').map(Number);
	const date = new Date(y, m - 1, d);
	const day = date.getDay(); // 0 = Sunday .. 6 = Saturday
	const mondayOffset = day === 0 ? -6 : 1 - day;

	const monday = new Date(date);
	monday.setDate(date.getDate() + mondayOffset);

	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(monday);
		d.setDate(monday.getDate() + i);
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	});
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
