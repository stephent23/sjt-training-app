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

	it('compares every week against the plan it replaces when revising a block', async () => {
		const deterministic = {
			weeks: pendingPlan.plan.weeks.map((w) => ({
				week_number: w.week_number + 4,
				sessions: w.sessions.map((s) => ({ ...s, label: 'Different' })),
			})),
		};
		const plan = { ...pendingPlan.plan, weeks: pendingPlan.plan.weeks.map((w) => ({ ...w, week_number: w.week_number + 4 })) };
		stubApi({ ...pendingPlan, plan, first_week_number: 5, deterministic, block: { id: 7, name: 'Block 2', week_count: 8 } });
		const root = await mount();
		expect(root.querySelector('.rv-week-head')!.textContent).toContain('1 changed');
		const heads = root.querySelectorAll('.rv-week-head');
		expect(heads[1].textContent).toContain('1 changed');
		(heads[1] as HTMLElement).click();
		await waitFor(() => root.querySelectorAll('.rv-session').length === 2);
		expect(root.querySelectorAll('.rv-session .badge--accent')).toHaveLength(2);
	});
});

describe('Adjust the current block', () => {
	const block = {
		id: 7,
		name: 'Block 2',
		start_date: '2026-10-26',
		week_count: 8,
		current_week: 4,
		weeks_remaining: 4,
		next_monday: '2026-11-23',
		summary: null,
	};

	function stubWithBlock(activeBlock: unknown, pending: unknown = null) {
		const fetchMock = stubApi(pending);
		const base = fetchMock.getMockImplementation()!;
		fetchMock.mockImplementation(async (url: string, init?: unknown) => {
			if (url === '/api/generator/active-block') {
				if (activeBlock instanceof Error) throw activeBlock;
				return json({ block: activeBlock });
			}
			if (url.startsWith('/api/generator/import')) return json({ id: 9 });
			return base(url, init as never);
		});
		return fetchMock;
	}

	const urls = (m: ReturnType<typeof stubApi>, prefix: string) => m.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith(prefix));

	it('offers the choice with Adjust selected, and no start picker', async () => {
		stubWithBlock(block);
		const root = await mount();
		await waitFor(() => root.querySelector('.mode-row') !== null);
		expect(button(root, 'Adjust Block 2').getAttribute('aria-pressed')).toBe('true');
		expect(button(root, 'New block').getAttribute('aria-pressed')).toBe('false');
		expect(root.querySelector('.start-row')).toBeNull();
		expect(root.textContent).toContain('Revises weeks 5–8 of Block 2, from Mon 23 Nov');
		expect(root.querySelector('.weeks-control-value')!.textContent).toContain('4');
		expect(root.textContent).toContain('Block ends Sun 20 Dec');
	});

	it('exports and imports against the block, and New block restores today’s URLs', async () => {
		const fetchMock = stubWithBlock(block);
		const root = await mount();
		await waitFor(() => root.querySelector('.mode-row') !== null);
		await waitFor(() => urls(fetchMock, '/api/generator/export').some((u) => u.includes('adjust=7')));
		expect(urls(fetchMock, '/api/generator/export')).toContain('/api/generator/export?weeks=4&adjust=7&startDate=2026-11-23');

		vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => JSON.stringify({ weeks: [] }) } });
		button(root, 'Paste Claude').click();
		await waitFor(() => urls(fetchMock, '/api/generator/import').length > 0);
		expect(urls(fetchMock, '/api/generator/import')[0]).toBe('/api/generator/import?adjust=7');

		button(root, 'New block').click();
		await waitFor(() => urls(fetchMock, '/api/generator/export').some((u) => !u.includes('adjust')));
		expect(urls(fetchMock, '/api/generator/export').pop()).toMatch(/^\/api\/generator\/export\?weeks=8&startDate=\d{4}-\d\d-\d\d$/);
		expect(root.querySelector('.start-row')).not.toBeNull();
		expect(JSON.parse(localStorage.getItem('generate-plan-v2')!).mode).toBe('new');
	});

	it('shows no choice without an active block, with none left, or when the lookup fails', async () => {
		for (const active of [null, { ...block, weeks_remaining: 0 }, new Error('offline')]) {
			stubWithBlock(active);
			const root = await mount();
			await tick();
			await tick();
			expect(root.querySelector('.mode-row')).toBeNull();
			expect(root.querySelector('.start-row')).not.toBeNull();
			render(null, container!);
			container!.remove();
			container = null;
			vi.unstubAllGlobals();
		}
	});

	it('titles an adjusting plan with the block’s own week numbers and says it was updated', async () => {
		const fetchMock = stubWithBlock(null, {
			...pendingPlan,
			first_week_number: 5,
			week_count: 2,
			block: { id: 7, name: 'Block 2', week_count: 8 },
			plan: { ...pendingPlan.plan, weeks: pendingPlan.plan.weeks.map((w, i) => ({ ...w, week_number: 5 + i })) },
		});
		const root = await mount();
		expect(root.querySelector('.rv-block-line')!.textContent).toBe('Updates Block 2 — weeks 5–6');
		expect([...root.querySelectorAll('.proposal-week-title')].map((e) => e.textContent)).toEqual(['Week 5 of 8', 'Week 6 of 8deload']);
		fetchMock.mockImplementation(async (url: string) => (url.endsWith('/accept') ? json({ ok: true }) : json({ pending: null })));
		button(root, 'Accept').click();
		await waitFor(() => root.querySelector('.done-card') !== null);
		expect(root.querySelector('.done-card')!.textContent).toContain('Block 2 updated');
	});

	it('leaves a new-block plan looking as before', async () => {
		stubWithBlock(block, pendingPlan);
		const root = await mount();
		expect(root.querySelector('.rv-block-line')).toBeNull();
		expect(root.querySelector('.proposal-week-title')!.textContent).toBe('Week 1 of 2');
	});
});
