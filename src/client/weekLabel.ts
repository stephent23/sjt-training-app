/** "Block 2 · Week 1 of 8" when the session belongs to a plan block, plain
 * "Week 6" for sessions with none (manual runs, data from before blocks). */
export function weekLabel(s: { week_number: number; block_name?: string | null; block_week_count?: number | null }): string {
	if (!s.block_name) return `Week ${s.week_number}`;
	const of = s.block_week_count ? ` of ${s.block_week_count}` : '';
	return `${s.block_name} · Week ${s.week_number}${of}`;
}
