import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Goals } from '../../src/client/screens/Goals';
import { addDaysIso, todayIso } from '../../src/dates';
import type { Race, Settings } from '../../src/types';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function waitFor(predicate: () => boolean, what = 'the screen to settle') {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error(`timed out waiting for ${what}`);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const future = addDaysIso(todayIso(), 120);
const past = addDaysIso(todayIso(), -30);

let races: Race[];
let settings: Settings;
let calls: { method: string; url: string; body: any }[];
let container: HTMLDivElement;

const race = (over: Partial<Race>): Race => ({ id: 1, name: 'Brighton Half', date: future, distance_km: 21.1, target_seconds: 6300, result_seconds: null, priority: 'A', ...over });

beforeEach(() => {
	races = [];
	settings = { goals: '', days_per_week: 5, goal_tags: [], max_hr: null, resting_hr: null, vo2max: null, threshold_pace_seconds_per_km: null, threshold_hr: null };
	calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init: RequestInit = {}) => {
			const method = init.method ?? 'GET';
			const body = init.body ? JSON.parse(init.body as string) : undefined;
			calls.push({ method, url, body });
			if (url === '/api/settings') return method === 'GET' ? json(settings) : json({ ok: true });
			if (url === '/api/races' && method === 'GET') return json({ races });
			if (url === '/api/races' && method === 'POST') return json({ race: { id: 9, ...body } });
			if (url.startsWith('/api/races/')) return method === 'DELETE' ? json({ ok: true }) : json({ race: { id: 1, ...body } });
			return json({}, 404);
		}),
	);
	container = document.createElement('div');
	document.body.appendChild(container);
});

afterEach(() => {
	render(null, container);
	container.remove();
	vi.unstubAllGlobals();
});

const maybe = (text: string) => [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text));
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text)) as HTMLButtonElement;
function type(el: HTMLInputElement, value: string) {
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
}
const input = (sel: string) => container.querySelector(sel) as HTMLInputElement;
const mount = async () => {
	render(<Goals />, container);
	await waitFor(() => container.textContent!.includes('From your watch'));
};
const raceCalls = (method: string) => calls.filter((c) => c.url.startsWith('/api/races') && c.method === method);

describe('Goals screen', () => {
	it('lists goals soonest first, results collapsed with the PB marked', async () => {
		races = [
			race({ id: 2, name: 'Later 10K', date: addDaysIso(future, 60), distance_km: 10 }),
			race({ id: 1 }),
			race({ id: 3, name: 'Old half', date: '2025-05-01', target_seconds: null, result_seconds: 6600 }),
			race({ id: 4, name: 'Newer half', date: '2026-01-01', target_seconds: null, result_seconds: 6300 }),
		];
		await mount();
		await waitFor(() => container.querySelectorAll('.race-row').length === 4);
		const names = [...container.querySelectorAll('.race-row strong')].map((e) => e.textContent);
		expect(names.slice(0, 2)).toEqual(['Brighton Half', 'Later 10K']);
		expect(container.textContent).toContain('target 1:45:00');
		expect(container.textContent).toContain('in 17 weeks');
		const results = container.querySelector('.race-results') as HTMLDetailsElement;
		expect(results.open).toBe(false);
		expect(results.textContent).toContain('PB');
		expect(results.querySelectorAll('.eyebrow')[1].textContent).toBe('Main');
	});

	it('adds a race with a target time, labelled by the date', async () => {
		await mount();
		button('Add a race').click();
		await waitFor(() => !!input('.race-form input[type=date]'));
		type(input('.race-form input[type=text]'), 'Brighton Half');
		type(input('.race-form input[type=date]'), future);
		await waitFor(() => container.textContent!.includes('Target time'));
		type(input('#race-time'), '14500');
		await waitFor(() => (input('#race-time')).value === '1:45:00');
		await waitFor(() => container.textContent!.includes('/km'));
		button('Add race').click();
		await waitFor(() => raceCalls('POST').length === 1);
		expect(raceCalls('POST')[0].body).toEqual({ name: 'Brighton Half', date: future, distance_km: 21.1, target_seconds: 6300, result_seconds: null, priority: 'A' });
	});

	it('calls the time a Result for a past date and stores it as one', async () => {
		await mount();
		button('Add a race').click();
		await waitFor(() => !!input('.race-form input[type=date]'));
		type(input('.race-form input[type=text]'), 'Parkrun');
		type(input('.race-form input[type=date]'), past);
		await waitFor(() => container.textContent!.includes('Result'));
		button('5K').click();
		await tick();
		type(input('#race-time'), '2300');
		await tick();
		button('Tune-up').click();
		await tick();
		button('Add race').click();
		await waitFor(() => raceCalls('POST').length === 1);
		expect(raceCalls('POST')[0].body).toMatchObject({ date: past, distance_km: 5, target_seconds: null, result_seconds: 1380, priority: 'B' });
	});

	it('edits a race and deletes only after confirming; offers Add your time on a passed goal', async () => {
		races = [race({ id: 1, date: past })];
		await mount();
		await waitFor(() => container.querySelectorAll('.race-row').length === 1);
		expect(container.textContent).toContain('Add your time');
		(container.querySelector('.race-row') as HTMLButtonElement).click();
		await waitFor(() => !!input('#race-time'));
		type(input('#race-time'), '14000');
		await tick();
		button('Save race').click();
		await waitFor(() => raceCalls('PUT').length === 1);
		expect(raceCalls('PUT')[0].body).toMatchObject({ result_seconds: 6000, target_seconds: 6300 });

		await waitFor(() => !input('#race-time'));
		await tick();
		(container.querySelector('.race-row') as HTMLButtonElement).click();
		await waitFor(() => !!button('Delete this race'));
		button('Delete this race').click();
		await waitFor(() => !!button('Yes, delete this race'));
		expect(raceCalls('DELETE')).toHaveLength(0);
		button('Yes, delete this race').click();
		await waitFor(() => raceCalls('DELETE').length === 1);
	});

	it('saves heart rate on blur', async () => {
		await mount();
		const maxHr = [...container.querySelectorAll('.goals-hr input')][0] as HTMLInputElement;
		type(maxHr, '188');
		await tick();
		maxHr.dispatchEvent(new Event('blur'));
		await waitFor(() => calls.some((c) => c.method === 'PATCH' && c.body.max_hr === 188));
		await waitFor(() => container.textContent!.includes('Saved'));
	});

	it('saves a Garmin threshold pace typed as digits, in seconds per km', async () => {
		await mount();
		const inputs = [...container.querySelectorAll('.goals-hr input')] as HTMLInputElement[];
		expect(inputs).toHaveLength(5);
		const pace = inputs[4];
		type(pace, '445');
		await tick();
		expect(pace.value).toBe('4:45');
		pace.dispatchEvent(new Event('blur'));
		await waitFor(() => calls.some((c) => c.method === 'PATCH' && c.body.threshold_pace_seconds_per_km === 285));
	});

	const openRace = async (r: Race) => {
		races = [r];
		await mount();
		await waitFor(() => container.querySelectorAll('.race-row').length >= 1);
		(container.querySelector('.race-row') as HTMLButtonElement).click();
		await waitFor(() => !!input('#race-time'));
	};

	it('never pre-fills a past race result from its target', async () => {
		await openRace(race({ date: past }));
		expect(input('#race-time').value).toBe('');
		expect(container.textContent).toContain('Result');
		button('Save race').click();
		await waitFor(() => raceCalls('PUT').length === 1);
		expect(raceCalls('PUT')[0].body).toMatchObject({ result_seconds: null, target_seconds: 6300 });
	});

	it('clears the target when the date is moved into the past, and restores it moving back', async () => {
		await openRace(race({}));
		expect(input('#race-time').value).toBe('1:45:00');
		type(input('.race-form input[type=date]'), past);
		await waitFor(() => input('#race-time').value === '');
		type(input('.race-form input[type=date]'), future);
		await waitFor(() => input('#race-time').value === '1:45:00');
	});

	it('treats race day as a result, with the time optional', async () => {
		await openRace(race({ date: todayIso() }));
		expect(container.textContent).toContain('Result');
		expect(input('#race-time').value).toBe('');
		button('Save race').click();
		await waitFor(() => raceCalls('PUT').length === 1);
		expect(raceCalls('PUT')[0].body).toMatchObject({ result_seconds: null });
	});

	it('shows only the form while adding or editing', async () => {
		races = [race({})];
		await mount();
		await waitFor(() => container.querySelectorAll('.race-row').length === 1);
		button('Add a race').click();
		await waitFor(() => !!input('.race-form'));
		expect(container.querySelector('.race-row')).toBeNull();
		expect(maybe('Add a race')).toBeUndefined();
	});

	it('ignores junk in heart rate fields', async () => {
		await mount();
		const maxHr = [...container.querySelectorAll('.goals-hr input')][0] as HTMLInputElement;
		type(maxHr, '185 bpm');
		await tick();
		expect(maxHr.value).toBe('185');
		maxHr.dispatchEvent(new Event('blur'));
		await waitFor(() => calls.some((c) => c.method === 'PATCH' && c.body.max_hr === 185));
	});

	it('offers Retry when loading fails', async () => {
		(fetch as any).mockImplementationOnce(async () => json({}, 500));
		render(<Goals />, container);
		await waitFor(() => !!maybe('Retry'));
		button('Retry').click();
		await waitFor(() => container.textContent!.includes('From your watch'));
	});
});
