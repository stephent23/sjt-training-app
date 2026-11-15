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
		summary: 'Cutting volume for the deload.',
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
		if (url === '/api/races') return json({ races: [] });
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
	await waitFor(() => container!.querySelector('.goals-link, .review') !== null);
	return container;
}

const button = (root: HTMLElement, text: string) => {
	// Matches the accessible name too: the −/+ weeks buttons are icon-only, named by aria-label.
	const el = [...root.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(text) || b.getAttribute('aria-label') === text);
	if (!el) throw new Error(`no button ${text}`);
	return el as HTMLButtonElement;
};

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

describe('New plan screen', () => {
	it('is one screen: goals link, start and length, two numbered actions', async () => {
		stubApi();
		const root = await mount();
		await waitFor(() => (root.querySelector('.goals-link')!.textContent ?? '').includes('No race set'));
		expect(root.querySelector('.goals-link')!.getAttribute('href')).toBe('#/goals');
		expect(button(root, 'Copy for Claude')).toBeTruthy();
		expect(button(root, 'Paste Claude')).toBeTruthy();
		expect(root.querySelector('.wizard-steps')).toBeNull();
	});

	it('keeps the weeks, start date and "asked" mark it was given', async () => {
		stubApi();
		let root = await mount();
		button(root, 'Week after').click();
		button(root, 'One week fewer').click();
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async () => {} } });
		button(root, 'Copy for Claude').click();
		await waitFor(() => JSON.parse(localStorage.getItem('generate-plan-v2') ?? '{}').asked === true);

		render(null, container!);
		container!.remove();
		container = null;

		stubApi();
		root = await mount();
		expect(root.querySelector('.weeks-control-value')!.textContent).toContain('7');
		const secondMonday = addDaysIso(weekStartOnOrAfter(todayIso()), 7);
		expect(root.querySelector('.start-chip[aria-pressed="true"]')!.textContent).toContain(String(Number(secondMonday.slice(8))));
		expect(button(root, 'Paste Claude').className).toContain('btn-primary');
	});

	it('shows only the review when a plan is already pending, with the coach note and outcome', async () => {
		stubApi(pendingPlan);
		const root = await mount();
		expect(root.querySelector('.goals-link')).toBeNull();
		expect(root.querySelector('.review-note')!.textContent).toContain('Cutting volume');
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
		await waitFor(() => root.querySelector('.done-card') !== null);
		expect(root.querySelector('.done-card a')!.getAttribute('href')).toBe('#/plan');
	});
});

describe('Review marks', () => {
	it('compares only week 1 against the mechanical baseline', async () => {
		const deterministic = {
			weeks: pendingPlan.plan.weeks.map((w) => ({
				week_number: w.week_number,
				sessions: w.sessions.map((s) => ({ ...s, label: 'Different' })),
			})),
		};
		stubApi({ ...pendingPlan, deterministic });
		const root = await mount();
		const heads = root.querySelectorAll('.rv-week-head');
		(heads[1] as HTMLElement).click();
		await waitFor(() => root.querySelectorAll('.rv-session').length === 2);
		expect(root.querySelectorAll('.rv-session .badge--accent')).toHaveLength(1);
		expect(root.textContent).not.toContain('speculative');
	});
});
