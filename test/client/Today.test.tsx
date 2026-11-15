import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Today } from '../../src/client/screens/Today';
import { addDaysIso, todayIso } from '../../src/dates';
import type { SessionSummary } from '../../src/types';

// Today's single-session fast path used to say a session was done only via
// the button label flipping to "Review it" — every other screen (Plan,
// History) marks status with an explicit badge next to the date, so a
// completed session on Today read differently from the exact same session
// seen anywhere else in the app.

let container: HTMLDivElement | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out waiting for the screen to render');
}

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id: 1,
		date: todayIso(),
		kind: 'lift',
		label: 'Lift A — pull bias',
		status: 'planned',
		week_number: 6,
		origin: 'planned',
		exercise_count: 7,
		planned_set_count: 23,
		logged_set_count: 0,
		run_type: null,
		target_minutes: null,
		target_km: null,
		has_logged_run: false,
		logged_distance_km: null,
		logged_duration_seconds: null,
		...overrides,
	};
}

async function mount(sessions: SessionSummary[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify({ sessions }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
	);

	container = document.createElement('div');
	document.body.appendChild(container);
	render(<Today />, container);
	await waitFor(() => container!.querySelector('h2, .empty-state') !== null);
	return container;
}

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
});

describe('Today — single session status', () => {
	it('shows no status badge for a session still planned', async () => {
		const root = await mount([session({ status: 'planned' })]);

		expect(root.querySelector('.eyebrow')!.textContent).not.toMatch(/completed|skipped/i);
	});

	it('shows a Completed badge once the session is marked complete', async () => {
		const root = await mount([session({ status: 'completed' })]);

		expect(root.querySelector('.eyebrow')!.textContent).toMatch(/completed/i);
	});

	it('shows a Skipped badge for a skipped session', async () => {
		const root = await mount([session({ status: 'skipped' })]);

		expect(root.querySelector('.eyebrow')!.textContent).toMatch(/skipped/i);
	});
});

describe('Today — plan block label', () => {
	it('reads "Block 2 · Week 1 of 8" when the session belongs to a block', async () => {
		const root = await mount([session({ week_number: 1, block_id: 2, block_name: 'Block 2', block_week_count: 8 })]);
		expect(root.textContent).toContain('Block 2 · Week 1 of 8');
	});

	it('falls back to a plain week number with no block', async () => {
		const root = await mount([session({ week_number: 6 })]);
		expect(root.textContent).toContain('Week 6');
		expect(root.textContent).not.toContain('Block');
	});
});

describe('Today — race countdown', () => {
	function race(overrides: Record<string, unknown> = {}) {
		return { id: 1, name: 'Brighton Half', date: addDaysIso(todayIso(), 119), distance_km: 21.1, target_seconds: null, result_seconds: null, priority: 'A', ...overrides };
	}

	async function mountWith(races: unknown, failRaces = false) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				if (String(url).includes('/api/races')) {
					if (failRaces) throw new Error('offline');
					return new Response(JSON.stringify({ races }), { status: 200, headers: { 'Content-Type': 'application/json' } });
				}
				return new Response(JSON.stringify({ sessions: [session()] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
			}),
		);
		container = document.createElement('div');
		document.body.appendChild(container);
		render(<Today />, container);
		await waitFor(() => container!.querySelector('h2') !== null);
		await tick();
		await tick();
		return container;
	}

	it('links the soonest unfinished race to the goals screen', async () => {
		const root = await mountWith([
			race({ id: 2, name: 'Later Half', date: addDaysIso(todayIso(), 200) }),
			race({ id: 3, name: 'Done 10k', date: addDaysIso(todayIso(), 5), result_seconds: 3000 }),
			race(),
		]);
		const link = root.querySelector<HTMLAnchorElement>('a.race-line')!;
		expect(link.textContent).toContain('Brighton Half · 17 weeks');
		expect(link.getAttribute('href')).toBe('#/goals');
	});

	it('shows nothing with no upcoming race', async () => {
		const root = await mountWith([race({ date: addDaysIso(todayIso(), -3) })]);
		expect(root.querySelector('.race-line')).toBeNull();
	});

	it('still renders Today when the races request fails', async () => {
		const root = await mountWith([], true);
		expect(root.querySelector('.race-line')).toBeNull();
		expect(root.textContent).toContain('Lift A');
	});
});
