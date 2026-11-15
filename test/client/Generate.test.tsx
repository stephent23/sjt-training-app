import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Generate } from '../../src/client/screens/Generate';
import { addDaysIso, todayIso, weekStartOnOrAfter } from '../../src/dates';

let container: HTMLDivElement | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 200; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out');
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const pendingPlan = {
	id: 5,
	first_week_number: 1,
	week_count: 2,
	created_at: '',
	replaces: 4,
	start_date: '2026-11-23',
	deterministic: { weeks: [] },
	plan: {
		weeks: [0, 1].map((w) => ({
			week_number: w + 1,
			focus: w === 1 ? 'deload' : null,
			sessions: [
				{
					date: addDaysIso('2026-11-23', 7 * w),
					kind: 'run',
					label: 'Easy run',
					plannedSets: [],
					plannedRun: { run_type: 'easy', target_minutes: 40, target_km: 6, structure_json: null },
				},
			],
		})),
	},
};

function stubApi(pending: unknown = null) {
	const fetchMock = vi.fn(async (url: string) => {
		if (url === '/api/generator/pending') return json({ pending });
		if (url.startsWith('/api/generator/export')) return json({ goals: '', goalTags: [], deterministicProposal: { weeks: [] } });
		if (url === '/api/settings') return json({ goals: '', days_per_week: 5, goal_tags: [] });
		if (url.endsWith('/accept')) return json({ ok: true });
		throw new Error(`unexpected fetch ${url}`);
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

async function mount() {
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<Generate />, container);
	await waitFor(() => container!.querySelector('.wizard-steps') !== null);
	return container;
}

const button = (root: HTMLElement, text: string) => {
	// Matches the accessible name too: the −/+ weeks buttons are icon-only, named by aria-label.
	const el = [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text) || b.getAttribute('aria-label') === text);
	if (!el) throw new Error(`no button ${text}`);
	return el as HTMLButtonElement;
};

const title = (root: HTMLElement) => root.querySelector('.wizard-title')!.textContent;

beforeEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
});

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
	vi.unstubAllGlobals();
});

describe('New plan flow', () => {
	it('walks Goals, Start and length, Ask Claude, Paste the answer', async () => {
		stubApi();
		const root = await mount();
		expect(title(root)).toBe('Goals');

		button(root, 'Next: start').click();
		await waitFor(() => title(root) === 'Start & length');
		button(root, 'Next: ask Claude').click();
		await waitFor(() => title(root) === 'Ask Claude');
		button(root, 'asked Claude').click();
		await waitFor(() => title(root) === 'Paste the answer');
	});

	it('keeps the weeks and start date it was given, and resumes on the step it left', async () => {
		stubApi();
		let root = await mount();
		button(root, 'Next: start').click();
		await waitFor(() => title(root) === 'Start & length');
		button(root, 'The week after').click();
		button(root, 'One week fewer').click();
		button(root, 'Next: ask Claude').click();
		await waitFor(() => title(root) === 'Ask Claude');

		render(null, container!);
		container!.remove();
		container = null;

		stubApi();
		root = await mount();
		expect(title(root)).toBe('Ask Claude');
		expect(root.querySelector('.chip-summary')!.textContent).toContain('7 weeks');
		const secondMonday = addDaysIso(weekStartOnOrAfter(todayIso()), 7);
		expect(root.querySelector('.chip-summary')!.textContent).toContain(String(Number(secondMonday.slice(8))));
	});

	it('lands straight on Review when a plan is already pending, and states the outcome', async () => {
		stubApi(pendingPlan);
		const root = await mount();
		expect(title(root)).toBe('Review');
		expect(root.querySelector('.rv-outcome')!.textContent).toContain('Replaces 4 planned sessions from');
		// Week 1 open, week 2 folded.
		expect(root.querySelectorAll('.rv-week-head[aria-expanded="true"]')).toHaveLength(1);
		expect(root.textContent).toContain('deload');
	});

	it('shows a success state linking to Plan after accepting', async () => {
		const fetchMock = stubApi(pendingPlan);
		const root = await mount();
		fetchMock.mockImplementation(async (url: string) => (url.endsWith('/accept') ? json({ ok: true }) : json({ pending: null })));

		button(root, 'Accept').click();
		await waitFor(() => root.querySelector('.wizard-done') !== null);
		expect(root.querySelector('.wizard-done a')!.getAttribute('href')).toBe('#/plan');
	});
});
