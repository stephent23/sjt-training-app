import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetRow } from '../../src/client/components/SetRow';
import { loggedEntry } from '../factories';

let container: HTMLDivElement | null = null;

type Props = Parameters<typeof SetRow>[0];

function mount(overrides: Partial<Props> = {}) {
	const onLog = vi.fn();
	const onToggleExpand = vi.fn();
	const props: Props = {
		label: 'Set 1',
		repLow: 8,
		repHigh: 10,
		incrementKg: 2.5,
		isBodyweight: false,
		defaultWeight: 20,
		defaultReps: null,
		logged: undefined,
		lastWeek: undefined,
		expanded: true,
		onToggleExpand,
		onLog,
		...overrides,
	};

	container = document.createElement('div');
	document.body.appendChild(container);
	render(<SetRow {...props} />, container);

	return { container, onLog, onToggleExpand };
}

/** The chips in a labelled TapGroup, e.g. the RIR row. */
function chips(root: HTMLElement, ariaLabelStartsWith: string): HTMLButtonElement[] {
	const group = [...root.querySelectorAll<HTMLElement>('.tap-row')].find((g) =>
		(g.getAttribute('aria-label') ?? '').startsWith(ariaLabelStartsWith),
	);
	return group ? [...group.querySelectorAll('button')] : [];
}

function pressedChip(root: HTMLElement, ariaLabelStartsWith: string): HTMLButtonElement | undefined {
	return chips(root, ariaLabelStartsWith).find((c) => c.getAttribute('aria-pressed') === 'true');
}

function primaryButton(root: HTMLElement): HTMLButtonElement {
	return root.querySelector<HTMLButtonElement>('button.btn-primary')!;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
});

describe('SetRow — RIR', () => {
	// The reported bug: after logging, the RIR chip went blank and "Update set"
	// was disabled, so a finished set looked broken rather than done.
	it('shows the recorded RIR and an ENABLED "Update set" for an already-logged set', () => {
		// defaultWeight/defaultReps are what resolveSetDefaults returns for a
		// logged set — this set's own recorded numbers.
		const { container } = mount({ defaultWeight: 60, defaultReps: 8, logged: loggedEntry({ weight_kg: 60, reps: 8, rir: 2 }) });

		expect(pressedChip(container, 'RIR')?.textContent).toBe('2');
		expect(primaryButton(container).textContent).toBe('Update set');
		expect(primaryButton(container).disabled).toBe(false);
	});

	// The guarantee that must survive the fix above.
	it('does NOT prefill RIR from last week', () => {
		const { container } = mount({ lastWeek: loggedEntry({ rir: 2 }), defaultReps: 8 });

		expect(pressedChip(container, 'RIR')).toBeUndefined();
		expect(primaryButton(container).disabled).toBe(true);
	});

	// defaultReps arriving from the previous set is resolveSetDefaults doing its
	// job; RIR must not come along for the ride.
	it('does NOT prefill RIR when reps were carried forward from the previous set', () => {
		const { container } = mount({ defaultReps: 9 });

		expect(pressedChip(container, 'Reps')?.textContent).toBe('9');
		expect(pressedChip(container, 'RIR')).toBeUndefined();
	});

	it('enables logging once reps and RIR are both chosen, and reports them', async () => {
		const { container, onLog } = mount({ defaultReps: 9 });

		expect(primaryButton(container).disabled).toBe(true);
		chips(container, 'RIR').find((c) => c.textContent === '1')!.click();
		await tick(); // Preact batches state updates

		expect(primaryButton(container).disabled).toBe(false);
		primaryButton(container).click();
		expect(onLog).toHaveBeenCalledWith(20, 9, 1);
	});
});

describe('SetRow — collapsed logged sets', () => {
	it('collapses a logged set to a single summary line with no controls', () => {
		const { container } = mount({ expanded: false, logged: loggedEntry({ weight_kg: 60, reps: 8, rir: 2 }) });

		expect(container.querySelector('.set-row-summary')?.textContent).toBe('60kg × 8 @ RIR 2');
		expect(container.querySelectorAll('.tap-row')).toHaveLength(0);
		expect(container.querySelector('.stepper')).toBeNull();
	});

	it('omits the weight from the summary for a bodyweight exercise', () => {
		const { container } = mount({ expanded: false, isBodyweight: true, logged: loggedEntry({ weight_kg: 0, reps: 10, rir: 1 }) });

		expect(container.querySelector('.set-row-summary')?.textContent).toBe('10 @ RIR 1');
	});

	it('tapping the collapsed row asks to expand it', () => {
		const { container, onToggleExpand } = mount({ expanded: false, logged: loggedEntry() });

		container.querySelector<HTMLButtonElement>('.set-row--collapsed')!.click();
		expect(onToggleExpand).toHaveBeenCalledOnce();
	});

	it('labels the collapsed row for screen readers, since several read just "Edit"', () => {
		const { container } = mount({ expanded: false, label: 'Triceps pushdown', logged: loggedEntry() });

		expect(container.querySelector('.set-row--collapsed')?.getAttribute('aria-label')).toBe('Edit Triceps pushdown');
	});

	// An unlogged set has nothing to collapse to — it must stay usable.
	it('never collapses a set that has not been logged, even when expanded is false', () => {
		const { container } = mount({ expanded: false, logged: undefined });

		expect(container.querySelector('.set-row--collapsed')).toBeNull();
		expect(container.querySelectorAll('.tap-row').length).toBeGreaterThan(0);
	});

	it('uses the given label as the row heading', () => {
		const { container } = mount({ label: 'DB bicep curl' });

		expect(container.querySelector('.set-row-index')?.textContent).toBe('DB bicep curl');
	});
});
