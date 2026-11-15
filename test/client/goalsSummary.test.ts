import { describe, expect, it } from 'vitest';
import { goalsSummary } from '../../src/client/goalsSummary';
import type { Race, Settings } from '../../src/types';

const settings: Settings = { goals: '', days_per_week: 5, goal_tags: ['build_strength', 'run_endurance'], max_hr: null, resting_hr: null, vo2max: null, threshold_pace_seconds_per_km: null, threshold_hr: null };
const race = (over: Partial<Race>): Race => ({
	id: 1,
	name: 'Brighton Half',
	date: '2027-03-07',
	distance_km: 21.1,
	target_seconds: 6300,
	result_seconds: null,
	priority: 'A',
	...over,
});

describe('goalsSummary', () => {
	it('names the next goal race, weeks away and target', () => {
		const s = goalsSummary(settings, [race({}), race({ id: 2, name: 'Later', date: '2027-05-01' })], '2026-11-08');
		expect(s.headline).toBe('Brighton Half · 17 weeks · target 1:45:00');
		expect(s.detail).toBe('Build strength + run endurance · 5 sessions a week');
	});

	it('skips past and finished races', () => {
		const s = goalsSummary(settings, [race({ date: '2026-01-01' }), race({ id: 2, result_seconds: 6000, date: '2027-01-01' })], '2026-11-08');
		expect(s.headline).toBe('No race set');
	});

	it('copes with no tags and no target', () => {
		const s = goalsSummary({ ...settings, goal_tags: [] }, [race({ target_seconds: null, date: '2026-11-09' })], '2026-11-08');
		expect(s.headline).toBe('Brighton Half · tomorrow');
		expect(s.detail).toBe('5 sessions a week');
	});
});
