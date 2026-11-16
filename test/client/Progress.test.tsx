import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Progress } from '../../src/client/screens/Progress';
import { addDaysIso } from '../../src/dates';
import type { Progress as ProgressData } from '../../src/progress';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out waiting for the screen to settle');
}

const FIRST_WEEK = '2026-08-17';
const weeks = (km: number[]): ProgressData['weeks'] =>
	km.map((k, i) => ({ week_start: addDaysIso(FIRST_WEEK, 7 * i), is_current: i === km.length - 1, km: k, long_run_km: k / 2, planned: 4, completed: 3 }));

const base = (): ProgressData => ({
	today: '2026-11-15',
	goal: {
		race: { name: 'Brighton Half', date: '2027-03-07', days_until: 112, target_seconds: 6300 },
		distance_km: 21.1,
		estimate: { seconds: 6430, source: 'training_run', date: '2026-11-03', distance_km: 10, effort_seconds: 2910 },
		pb: { seconds: 6500, date: '2024-03-03', name: 'Old Half' },
		gap_seconds: 130,
	},
	weeks: weeks([10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 8]),
	easy_pace: { first_seconds_per_km: 365, last_seconds_per_km: 352, first_avg_hr: 148, last_avg_hr: 145 },
	adherence_pct: 87.4,
	lifts: [
		{
			exercise_id: 1,
			name: 'Squat',
			points: [
				{ week_start: '2026-10-19', e1rm_kg: 70 },
				{ week_start: '2026-11-02', e1rm_kg: 77 },
			],
			last_e1rm_kg: 77,
			change_kg: 7,
		},
	],
});

let container: HTMLDivElement;
let payload: ProgressData;

beforeEach(() => {
	payload = base();
	vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })));
	container = document.createElement('div');
	document.body.appendChild(container);
});

afterEach(() => {
	render(null, container);
	container.remove();
	vi.unstubAllGlobals();
});

async function mount() {
	render(<Progress />, container);
	await waitFor(() => container.querySelector('.card') !== null);
	return container.textContent ?? '';
}

describe('Progress', () => {
	it('shows the race, target, estimate and best, and how far off the target is', async () => {
		const text = await mount();

		expect(text).toContain('Brighton Half · in 112 days');
		expect(text).toContain('1:45:00'); // target
		expect(text).toContain('1:47:10'); // estimate
		expect(text).toContain('1:48:20'); // best
		expect(text).toContain('2:10 to find to hit your target.');
		expect(text).toContain('a training run');
	});

	it('says so when the estimate is inside the target', async () => {
		payload.goal.gap_seconds = -45;
		expect(await mount()).toContain('0:45 inside your target on current form.');
	});

	it('opens on the last full week and reads out the week a tapped bar belongs to', async () => {
		const text = await mount();
		expect(text).toContain('Week of 2 Nov · 32 km · longest 16 km');

		const firstBar = container.querySelector('.bar-col') as HTMLButtonElement;
		firstBar.click();
		await tick();

		expect(container.querySelector('.bars-caption')!.textContent).toContain('Week of 17 Aug · 10 km · longest 5 km');
		// Both charts follow the same selection.
		expect(container.querySelectorAll('.bar-col[aria-pressed="true"]')).toHaveLength(2);
	});

	it('shows each lift with its latest estimate and change, and the adherence line', async () => {
		const text = await mount();

		expect(container.querySelector('.lift-row')!.textContent).toContain('Squat');
		expect(container.querySelector('.lift-row')!.textContent).toContain('77 kg');
		expect(container.querySelector('.lift-row')!.textContent).toContain('+7 kg');
		expect(text).toContain('87% of your planned sessions');
	});

	it('has plain empty states with no race, no runs and no lifts', async () => {
		payload = { ...base(), goal: { race: null, distance_km: 21.1, estimate: null, pb: null, gap_seconds: null }, weeks: weeks(Array(13).fill(0)), lifts: [], adherence_pct: null };
		const text = await mount();

		expect(text).toContain('Half marathon');
		expect(text).toContain('Add one in Goals');
		expect(text).toContain('No runs logged in the last 12 weeks.');
		expect(text).toContain('Train a lift in two different weeks');
	});
});
