import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Preview } from '../../src/client/screens/Preview';
import type { SessionDetail } from '../../src/types';
import { plannedSet } from '../factories';

let container: HTMLDivElement | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out');
}

const detail: SessionDetail = {
	session: { id: 9, date: '2026-11-30', kind: 'lift', label: 'Lift A', status: 'planned', week_number: 3, origin: 'planned' },
	plannedSets: [
		plannedSet({ id: 1, exercise_id: 1, exercise_name: 'Neutral-grip DB press', order_index: 1, superset_group: 3 }),
		plannedSet({ id: 2, exercise_id: 11, exercise_name: 'Single-arm DB row', order_index: 2, superset_group: 3 }),
		plannedSet({ id: 3, exercise_id: 7, exercise_name: 'Lat pulldown', order_index: 3 }),
	],
	plannedRun: null,
	loggedRun: null,
	feedback: null,
};

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
	localStorage.clear();
	vi.unstubAllGlobals();
});

describe('Preview', () => {
	it('shows a superset as one group with its members, and solos on their own', async () => {
		localStorage.clear();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(detail), { status: 200, headers: { 'Content-Type': 'application/json' } })));
		container = document.createElement('div');
		document.body.appendChild(container);
		render(<Preview sessionId={9} onBack={() => {}} />, container);
		await waitFor(() => container!.querySelector('h1') !== null);

		const groups = container.querySelectorAll('.exercise-card--superset');
		expect(groups).toHaveLength(1);
		expect(groups[0].textContent).toContain('Superset · 3 rounds');
		expect([...groups[0].querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['Neutral-grip DB press', 'Single-arm DB row']);
		expect(container.textContent).toContain('Lat pulldown');
	});
});
