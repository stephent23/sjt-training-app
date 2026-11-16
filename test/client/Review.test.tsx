import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Review, describeSets } from '../../src/client/screens/Review';
import type { SessionDetail } from '../../src/types';
import { loggedEntry, loggedSets, plannedSet } from '../factories';

let container: HTMLDivElement | null = null;
let calls: { url: string; method: string; body: any }[] = [];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function liftDetail(): SessionDetail {
	return {
		session: { id: 3, date: '2026-08-03', kind: 'lift', label: 'Lift A', status: 'planned', week_number: 1, origin: 'planned' },
		plannedSets: [
			// Complete: every set logged.
			plannedSet({
				id: 1,
				exercise_id: 11,
				exercise_name: 'Goblet squat',
				logged: [
					loggedEntry({ set_index: 1, weight_kg: 24, reps: 10, rir: 1 }),
					loggedEntry({ set_index: 2, weight_kg: 24, reps: 9, rir: 2 }),
					loggedEntry({ set_index: 3, weight_kg: 24, reps: 8, rir: 3 }),
				],
			}),
			// Incomplete: gaps.
			plannedSet({ id: 2, exercise_id: 12, exercise_name: 'Press', logged: loggedSets(2, { weight_kg: 35, reps: 12, rir: 2 }) }),
			// Skipped, nothing logged.
			plannedSet({ id: 3, exercise_id: 13, exercise_name: 'Face pulls', status: 'skipped' }),
			// Skipped after logging something.
			plannedSet({ id: 4, exercise_id: 14, exercise_name: 'Curl', status: 'skipped', logged: loggedSets(1) }),
		],
		plannedRun: null,
		loggedRun: null,
		feedback: null,
	};
}

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out');
}

async function mount(detail: SessionDetail) {
	localStorage.clear();
	calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			if (method !== 'GET') calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
			return new Response(JSON.stringify(method === 'GET' ? detail : { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}),
	);
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<Review sessionId={detail.session.id} />, container);
	await waitFor(() => container!.querySelector('.rv-ex') !== null);
	return container;
}

function row(root: HTMLElement, name: string): HTMLElement {
	const el = [...root.querySelectorAll<HTMLElement>('.rv-ex')].find((e) => e.querySelector('.rv-ex-name')?.textContent === name);
	if (!el) throw new Error(`no row ${name}`);
	return el;
}

async function change(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	input.dispatchEvent(new Event('change', { bubbles: true }));
	await tick();
}

beforeEach(() => vi.restoreAllMocks());

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
	localStorage.clear();
});

describe('describeSets', () => {
	it('summarises a uniform exercise on one line', () => {
		expect(describeSets(liftDetail().plannedSets[0].logged, 3)).toBe('24 kg · 10 / 9 / 8 reps · RIR 1–3');
	});

	it('shows varying weights as a range and says how many sets are in', () => {
		const logged = [loggedEntry({ set_index: 1, weight_kg: 22, reps: 10, rir: 2 }), loggedEntry({ set_index: 2, weight_kg: 24, reps: 8, rir: 2 })];
		expect(describeSets(logged, 3)).toBe('2 of 3 sets · 22–24 kg · 10 / 8 reps · RIR 2');
	});

	it('says Not logged for an untouched exercise', () => {
		expect(describeSets([], 3)).toBe('Not logged');
	});
});

describe('Review (lift)', () => {
	it('shows a summary per exercise and ticks only the complete one', async () => {
		const root = await mount(liftDetail());

		expect(row(root, 'Goblet squat').textContent).toContain('24 kg · 10 / 9 / 8 reps · RIR 1–3');
		expect(row(root, 'Goblet squat').querySelector('[aria-label="All sets logged"]')).not.toBeNull();
		expect(row(root, 'Press').querySelector('[aria-label="All sets logged"]')).toBeNull();
	});

	it('opens exercises with gaps by themselves and leaves complete ones closed', async () => {
		const root = await mount(liftDetail());

		expect(row(root, 'Goblet squat').querySelector('details')!.open).toBe(false);
		expect(row(root, 'Press').querySelector('details')!.open).toBe(true);
	});

	it('says Skipped with an Unskip button, and keeps logged sets inspectable', async () => {
		const root = await mount(liftDetail());

		const faces = row(root, 'Face pulls');
		expect(faces.textContent).toContain('Skipped');
		expect(faces.querySelector('table')).toBeNull();
		expect(faces.querySelector('button')!.textContent).toBe('Unskip');

		expect(row(root, 'Curl').querySelector('table')).not.toBeNull();

		faces.querySelector('button')!.click();
		await waitFor(() => calls.some((c) => c.url.endsWith('/exercises/3/status')));
		expect(calls.find((c) => c.url.endsWith('/exercises/3/status'))!.body).toEqual({ status: 'planned' });
	});

	it('writes on change, not per keystroke, and fills a gap on the session date', async () => {
		const root = await mount(liftDetail());
		const inputs = row(root, 'Press').querySelectorAll<HTMLInputElement>('input');
		// Set 3 is the empty one: weight, reps, rir.
		const [w, r, ri] = [inputs[6], inputs[7], inputs[8]];

		w.value = '3';
		w.dispatchEvent(new Event('input', { bubbles: true }));
		w.value = '36';
		w.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(calls).toHaveLength(0);

		await change(w, '36');
		await change(r, '10');
		await change(ri, '2');
		await waitFor(() => calls.some((c) => c.url.endsWith('/sets')));

		const sent = calls.filter((c) => c.url.endsWith('/sets')).pop()!.body;
		expect(sent).toMatchObject({ exercise_id: 12, set_index: 3, weight_kg: 36, reps: 10, rir: 2, performed_on: '2026-08-03' });
	});

	it('refuses an RIR above 4', async () => {
		const root = await mount(liftDetail());
		const inputs = row(root, 'Press').querySelectorAll<HTMLInputElement>('input');

		await change(inputs[6], '36');
		await change(inputs[7], '10');
		await change(inputs[8], '9');
		await tick();

		expect(calls.filter((c) => c.url.endsWith('/sets'))).toHaveLength(0);
	});
});
