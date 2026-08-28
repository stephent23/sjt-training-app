import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plan } from '../../src/client/screens/Plan';
import { addDaysIso, todayIso } from '../../src/dates';
import type { SessionSummary } from '../../src/types';

// Plan is "what's coming" — once a session is completed it isn't coming
// anymore, so it drops off Plan entirely (it's still fully visible on
// History). A skipped session stays, on the reasoning that it may still need
// rescheduling.

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
		label: 'Session',
		status: 'planned',
		week_number: 6,
		origin: 'planned',
		exercise_count: 5,
		planned_set_count: 15,
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
	render(<Plan />, container);
	await waitFor(() => container!.querySelector('.plan-row-title, .empty-state') !== null);
	return container;
}

// `.plan-row-title` is used both by the week-group header ("Week 6") and by
// each individual session row ("session.label") — scoped to the anchor rows
// only, so a week heading never gets mistaken for a session.
function labels(root: HTMLElement): string[] {
	return [...root.querySelectorAll('a.plan-row .plan-row-title')].map((el) => el.textContent ?? '');
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

describe('Plan — hides sessions that are done', () => {
	it('does not show a completed session', async () => {
		const root = await mount([
			session({ id: 1, label: 'Still to come', status: 'planned' }),
			session({ id: 2, label: 'Already done', status: 'completed' }),
		]);

		expect(labels(root)).toEqual(['Still to come']);
	});

	it('still shows a skipped session', async () => {
		const root = await mount([
			session({ id: 1, label: 'Still to come', status: 'planned' }),
			session({ id: 2, label: 'Skipped one', status: 'skipped' }),
		]);

		expect(labels(root)).toEqual(['Still to come', 'Skipped one']);
	});

	// A week whose every session is done shouldn't leave a heading behind with
	// nothing under it.
	it('drops a week entirely once every session in it is completed', async () => {
		const root = await mount([
			session({ id: 1, label: 'Done A', status: 'completed', week_number: 6, date: todayIso() }),
			session({ id: 2, label: 'Done B', status: 'completed', week_number: 6, date: addDaysIso(todayIso(), 1) }),
			session({ id: 3, label: 'Next week', status: 'planned', week_number: 7, date: addDaysIso(todayIso(), 7) }),
		]);

		expect(labels(root)).toEqual(['Next week']);
		expect(root.textContent).not.toMatch(/Week 6/);
	});

	it('shows nothing-planned message when every session is completed', async () => {
		const root = await mount([session({ status: 'completed' })]);

		expect(root.querySelector('.empty-state')).not.toBeNull();
	});
});
