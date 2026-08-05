import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExerciseCard } from '../../src/client/components/ExerciseCard';
import { groupPlannedSets } from '../../src/supersets';
import type { PlannedSetDetail } from '../../src/types';
import { loggedSets, plannedSet } from '../factories';

let container: HTMLDivElement | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(plannedSets: PlannedSetDetail[], { expanded = true }: { expanded?: boolean } = {}) {
	const onLog = vi.fn();
	const onSwap = vi.fn();
	const onSkipToggle = vi.fn();
	const onToggle = vi.fn();
	const group = groupPlannedSets(plannedSets)[0];

	container = document.createElement('div');
	document.body.appendChild(container);
	render(
		<ExerciseCard
			group={group}
			expanded={expanded}
			onToggle={onToggle}
			onLog={onLog}
			onSwap={onSwap}
			onSkipToggle={onSkipToggle}
			restNode={null}
			restAfterRoundIndex={null}
		/>,
		container,
	);

	return { container, group, onLog, onSwap, onSkipToggle, onToggle };
}

function text(root: HTMLElement, selector: string): string[] {
	return [...root.querySelectorAll(selector)].map((el) => el.textContent ?? '');
}

/** Row headings, which are "Set N" for a solo and the exercise name in a superset. */
function slotLabels(root: HTMLElement): string[] {
	return text(root, '.set-row-index');
}

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
});

describe('ExerciseCard — solo exercise (non-regression)', () => {
	it('renders the prescription eyebrow, name and one row per set, with no round headings', () => {
		const { container } = mount([plannedSet({ target_sets: 3, rep_low: 8, rep_high: 10, exercise_name: 'Leg press' })]);

		expect(text(container, '.eyebrow')).toContain('3 × 8-10');
		expect(text(container, '.plan-row-title')).toEqual(['Leg press']);
		expect(slotLabels(container)).toEqual(['Set 1', 'Set 2', 'Set 3']);
		expect(container.querySelector('.superset-round-label')).toBeNull();
		expect(container.querySelector('.eyebrow--accent')).toBeNull();
	});

	it('reports progress through the sets', () => {
		expect(text(mount([plannedSet({ target_sets: 3 })]).container, '.plan-row-meta')).toEqual(['3 sets']);
	});

	it('reports Done once every set is logged', () => {
		const { container } = mount([plannedSet({ target_sets: 2, logged: loggedSets(2) })]);
		expect(text(container, '.plan-row-meta')).toEqual(['Done']);
	});

	it('offers Swap and Skip for the one exercise', () => {
		const { container, onSwap, onSkipToggle, group } = mount([plannedSet({ exercise_name: 'Leg press' })]);
		const buttons = [...container.querySelectorAll<HTMLButtonElement>('.exercise-card-actions button')];

		expect(buttons.map((b) => b.textContent)).toEqual(['Swap exercise', 'Skip exercise']);
		buttons[0].click();
		buttons[1].click();
		expect(onSwap).toHaveBeenCalledWith(group.members[0]);
		expect(onSkipToggle).toHaveBeenCalledWith(group.members[0]);
	});

	it('renders no set rows for a skipped exercise but still offers Unskip', () => {
		const { container } = mount([plannedSet({ status: 'skipped' })]);

		expect(slotLabels(container)).toEqual([]);
		expect(text(container, '.plan-row-meta')).toEqual(['Skipped']);
		expect(text(container, '.exercise-card-actions button')).toContain('Unskip');
	});
});

describe('ExerciseCard — superset', () => {
	function pair(overrides: { a?: Partial<PlannedSetDetail>; b?: Partial<PlannedSetDetail> } = {}) {
		return [
			plannedSet({ id: 7, order_index: 7, superset_group: 1, exercise_id: 26, exercise_name: 'DB bicep curl', target_sets: 3, rest_seconds: 0, ...overrides.a }),
			plannedSet({ id: 8, order_index: 8, superset_group: 1, exercise_id: 28, exercise_name: 'Triceps pushdown', target_sets: 3, rest_seconds: 90, ...overrides.b }),
		];
	}

	// The core fix: sets read across the rounds you perform, not down each
	// exercise, and both exercises live in ONE card.
	it('renders one round per set, with both members in order_index order inside each', () => {
		const { container } = mount(pair());

		expect(text(container, '.superset-round-label')).toEqual(['Round 1', 'Round 2', 'Round 3']);
		expect(slotLabels(container)).toEqual([
			'DB bicep curl',
			'Triceps pushdown',
			'DB bicep curl',
			'Triceps pushdown',
			'DB bicep curl',
			'Triceps pushdown',
		]);
	});

	it('marks itself as a superset and lists both names in the summary', () => {
		const { container } = mount(pair());

		expect(container.querySelector('.exercise-card--superset')).not.toBeNull();
		expect(text(container, '.eyebrow--accent')).toEqual(['Superset']);
		expect(text(container, '.plan-row-title')).toEqual(['DB bicep curl', 'Triceps pushdown']);
		expect(text(container, '.eyebrow')).toContain('3 rounds');
	});

	it('reports the round you are on once a round is finished', () => {
		const { container } = mount(pair({ a: { logged: loggedSets(1) }, b: { logged: loggedSets(1) } }));

		expect(text(container, '.plan-row-meta')).toEqual(['Round 2 of 3']);
	});

	it('still reports the opening round while a round is only half done', () => {
		const { container } = mount(pair({ a: { logged: loggedSets(1) } }));

		expect(text(container, '.plan-row-meta')).toEqual(['3 rounds']);
	});

	it('drops a member from rounds beyond its own set count', () => {
		const { container } = mount(pair({ b: { target_sets: 2 } }));

		expect(text(container, '.superset-round-label')).toEqual(['Round 1', 'Round 2', 'Round 3']);
		expect(slotLabels(container).filter((l) => l === 'Triceps pushdown')).toHaveLength(2);
	});

	it('gives a skipped member no set rows but keeps its own Unskip control', () => {
		const { container } = mount(pair({ b: { status: 'skipped' } }));

		expect(slotLabels(container).every((l) => l === 'DB bicep curl')).toBe(true);
		expect(text(container, '.exercise-card-member button')).toEqual(['Swap', 'Skip', 'Swap', 'Unskip']);
	});

	it('is only Skipped when every member is skipped', () => {
		expect(text(mount(pair({ b: { status: 'skipped' } })).container, '.plan-row-meta')).toEqual(['3 rounds']);
		expect(text(mount(pair({ a: { status: 'skipped' }, b: { status: 'skipped' } })).container, '.plan-row-meta')).toEqual(['Skipped']);
	});

	it('routes swap and skip to the member they belong to', () => {
		const { container, group, onSwap } = mount(pair());

		[...container.querySelectorAll<HTMLButtonElement>('.exercise-card-member button')][2].click(); // second member's Swap
		expect(onSwap).toHaveBeenCalledWith(group.members[1]);
	});

	it('reports each member note against its own exercise', () => {
		const { container } = mount(pair({ a: { notes: 'no rest after this' }, b: { notes: 'full rest' } }));

		expect(text(container, '.exercise-target')).toEqual(['DB bicep curl: no rest after this', 'Triceps pushdown: full rest']);
	});
});

describe('ExerciseCard — logged sets collapse', () => {
	it('collapses a logged set and leaves the next one open', () => {
		const { container } = mount([plannedSet({ target_sets: 3, logged: loggedSets(1, { weight_kg: 60, reps: 8, rir: 2 }) })]);

		expect(container.querySelectorAll('.set-row--collapsed')).toHaveLength(1);
		expect(text(container, '.set-row-summary')).toEqual(['60kg × 8 @ RIR 2']);
		// Sets 2 and 3 are unlogged, so they keep their live controls.
		expect(container.querySelectorAll('.tap-row').length).toBeGreaterThan(0);
	});

	it('expands a logged set for editing when its row is tapped, and only that one', async () => {
		const { container } = mount([plannedSet({ target_sets: 3, logged: loggedSets(2) })]);

		expect(container.querySelectorAll('.set-row--collapsed')).toHaveLength(2);
		container.querySelector<HTMLButtonElement>('.set-row--collapsed')!.click();
		await tick();

		expect(container.querySelectorAll('.set-row--collapsed')).toHaveLength(1);
		expect(container.querySelector('.set-row--editing')).not.toBeNull();
	});
});
