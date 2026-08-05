import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiftSession } from '../../src/client/screens/LiftSession';
import type { SessionDetail } from '../../src/types';
import { loggedSets, plannedSet } from '../factories';

// A smoke test, not a unit test: the interesting logic all lives in
// src/supersets.ts and src/sessionProgress.ts, which are tested directly.
// What this covers is that the screen actually mounts and wires those
// together — a crash in here would take out the entire lift flow, and the
// pure tests would still be green.

let container: HTMLDivElement | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// Wednesday's real shape: solo work, a superset, and skipped accessories.
function sessionDetail(): SessionDetail {
	return {
		session: { id: 8, date: '2026-08-05', kind: 'lift', label: 'Lift B — push bias', status: 'planned', week_number: 1 },
		plannedSets: [
			plannedSet({ id: 1, order_index: 1, exercise_id: 1, exercise_name: 'Neutral-grip DB press', target_sets: 4, rest_seconds: 150, logged: loggedSets(4) }),
			plannedSet({ id: 7, order_index: 7, exercise_id: 26, exercise_name: 'DB bicep curl', target_sets: 3, rest_seconds: 0, superset_group: 1 }),
			plannedSet({ id: 8, order_index: 8, exercise_id: 28, exercise_name: 'Triceps pushdown', target_sets: 3, rest_seconds: 90, superset_group: 1 }),
			plannedSet({ id: 9, order_index: 9, exercise_id: 33, exercise_name: 'Face pulls', target_sets: 3, status: 'skipped' }),
		],
		plannedRun: null,
		loggedRun: null,
		feedback: null,
	};
}

/** Polls rather than guessing a tick count: useSession fetches, awaits
 *  res.json(), sets state and then Preact renders, and the very first module
 *  import in the file is slow enough that a fixed number of ticks passes for
 *  some tests and not others. */
async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out waiting for the screen to render');
}

async function mountLiftSession(detail: SessionDetail) {
	localStorage.clear();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(detail), { status: 200, headers: { 'Content-Type': 'application/json' } })),
	);

	container = document.createElement('div');
	document.body.appendChild(container);
	render(<LiftSession sessionId={detail.session.id} onBack={() => {}} />, container);
	await waitFor(() => container!.querySelector('.exercise-card') !== null);
	return container;
}

function text(root: HTMLElement, selector: string): string[] {
	return [...root.querySelectorAll(selector)].map((el) => el.textContent ?? '');
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
	localStorage.clear();
});

describe('LiftSession', () => {
	it('renders the session without crashing, one card per group', async () => {
		const root = await mountLiftSession(sessionDetail());

		// Four planned sets, but three cards: the superset pair is one.
		expect(root.querySelectorAll('.exercise-card')).toHaveLength(3);
		expect(root.querySelectorAll('.exercise-card--superset')).toHaveLength(1);
	});

	// The bug that started this: 26 sets logged, three exercises skipped, and
	// the session could never read as finished.
	it('counts only non-skipped work in the progress line', async () => {
		const root = await mountLiftSession(sessionDetail());

		// 4 logged of (4 press + 3 curl + 3 pushdown) = 10; Face pulls excluded.
		expect(text(root, '.exercise-target')).toContain('4 of 10 sets logged');
	});

	it('offers the finish controls the screen previously lacked entirely', async () => {
		const root = await mountLiftSession(sessionDetail());
		const labels = text(root, 'main > button');

		expect(labels).toContain('Mark complete');
		expect(labels).toContain('Mark skipped');
	});

	it('leaves "Mark complete" secondary while work is outstanding', async () => {
		const root = await mountLiftSession(sessionDetail());

		expect(root.querySelector('.btn-primary')).toBeNull();
	});

	it('promotes "Mark complete" to primary once everything non-skipped is logged', async () => {
		const detail = sessionDetail();
		detail.plannedSets[1].logged = loggedSets(3);
		detail.plannedSets[2].logged = loggedSets(3);
		const root = await mountLiftSession(detail);

		expect(root.querySelector('.btn-primary')?.textContent).toBe('Mark complete');
	});

	it('shows the superset as a single card of rounds when opened', async () => {
		const root = await mountLiftSession(sessionDetail());

		const supersetSummary = root.querySelector<HTMLButtonElement>('.exercise-card--superset .exercise-card-summary')!;
		supersetSummary.click();
		await tick();

		expect(text(root, '.superset-round-label')).toEqual(['Round 1', 'Round 2', 'Round 3']);
		expect(text(root, '.set-row-index')).toEqual([
			'DB bicep curl',
			'Triceps pushdown',
			'DB bicep curl',
			'Triceps pushdown',
			'DB bicep curl',
			'Triceps pushdown',
		]);
	});

	it('collapses already-logged sets to summary lines when a card is opened', async () => {
		const root = await mountLiftSession(sessionDetail());

		root.querySelector<HTMLButtonElement>('.exercise-card-summary')!.click(); // the fully-logged press
		await tick();

		expect(root.querySelectorAll('.set-row--collapsed')).toHaveLength(4);
	});
});
