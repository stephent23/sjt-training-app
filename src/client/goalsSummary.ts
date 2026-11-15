import type { Race, Settings } from '../types';
import { daysBetweenIso } from '../dates';
import { formatDuration } from './format';

/** "in 17 weeks", "in 3 days", "tomorrow", "today". Past dates return ''. */
export function untilLabel(date: string, today: string): string {
	const days = daysBetweenIso(today, date);
	if (days < 0) return '';
	if (days === 0) return 'today';
	if (days === 1) return 'tomorrow';
	if (days < 14) return `in ${days} days`;
	return `in ${Math.round(days / 7)} weeks`;
}

function tagLabel(tag: string): string {
	return tag.replace(/_/g, ' ');
}

/** The two lines the New plan screen shows for "what am I training for":
 * the next goal race (soonest upcoming without a result) and the focus tags. */
export function goalsSummary(settings: Settings, races: Race[], today: string): { headline: string; detail: string } {
	const next = races
		.filter((r) => r.date >= today && r.result_seconds == null)
		.sort((a, b) => a.date.localeCompare(b.date))[0];

	let headline = 'No race set';
	if (next) {
		const parts = [next.name, untilLabel(next.date, today).replace(/^in /, '')];
		if (next.target_seconds) parts.push(`target ${formatDuration(next.target_seconds)}`);
		headline = parts.join(' · ');
	}

	const parts: string[] = [];
	if (settings.goal_tags.length > 0) {
		const tags = settings.goal_tags.slice(0, 3).map(tagLabel).join(' + ');
		parts.push(tags.charAt(0).toUpperCase() + tags.slice(1));
	}
	parts.push(`${settings.days_per_week} sessions a week`);
	return { headline, detail: parts.join(' · ') };
}
