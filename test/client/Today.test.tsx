import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Today } from '../../src/client/screens/Today';
import { todayIso } from '../../src/dates';
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
