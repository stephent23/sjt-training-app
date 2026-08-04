import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Stepper } from '../../src/client/components/Stepper';

let container: HTMLDivElement | null = null;

function mount(value: number, step: number, onChange: (v: number) => void) {
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<Stepper value={value} step={step} suffix="kg" onChange={onChange} />, container);
	return {
		decrease: container.querySelector<HTMLButtonElement>('button[aria-label="Decrease"]')!,
		increase: container.querySelector<HTMLButtonElement>('button[aria-label="Increase"]')!,
		input: container.querySelector<HTMLInputElement>('input')!,
	};
}

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
});

// Preact batches state updates, so each step has to settle before the next
// event fires — otherwise the blur handler still closes over the pre-focus
// `draft` (null) and commit() bails before ever calling onChange.
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function type(input: HTMLInputElement, value: string) {
	input.dispatchEvent(new FocusEvent('focus'));
	await tick();
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	input.dispatchEvent(new FocusEvent('blur'));
	await tick();
}

describe('Stepper', () => {
	it('adds the step on increase', () => {
		const onChange = vi.fn();
		const { increase } = mount(20, 2.5, onChange);

		increase.click();

		expect(onChange).toHaveBeenCalledWith(22.5);
	});

	// The whole point of round2: repeatedly adding a fractional increment
	// accumulates float error (20 + 0.1 -> 20.000000000000004), which would
	// otherwise be written to the DB and shown on screen.
	it('rounds float artefacts from fractional increments to 2dp', () => {
		const onChange = vi.fn();
		const { increase } = mount(20.1, 0.2, onChange);

		increase.click();

		expect(onChange).toHaveBeenCalledWith(20.3);
	});

	// Guards the comment in Stepper.tsx: round2 must NOT snap to a multiple of
	// `step`. 22.5 + 2 = 24.5 is a legitimate weight on a machine whose
	// increment is 2kg; snapping to 24 would silently destroy it.
	it('does not snap to a multiple of the step — 22.5 + 2 stays 24.5', () => {
		const onChange = vi.fn();
		const { increase } = mount(22.5, 2, onChange);

		increase.click();

		expect(onChange).toHaveBeenCalledWith(24.5);
	});

	it('never goes below zero on decrease', () => {
		const onChange = vi.fn();
		const { decrease } = mount(1, 2.5, onChange);

		decrease.click();

		expect(onChange).toHaveBeenCalledWith(0);
	});

	it('commits a typed value on blur', async () => {
		const onChange = vi.fn();
		const { input } = mount(20, 2.5, onChange);

		await type(input, '42.5');

		expect(onChange).toHaveBeenCalledWith(42.5);
	});

	it('clamps a typed negative to zero', async () => {
		const onChange = vi.fn();
		const { input } = mount(20, 2.5, onChange);

		await type(input, '-5');

		expect(onChange).toHaveBeenCalledWith(0);
	});

	it('silently reverts an unparseable typed value rather than writing NaN', async () => {
		const onChange = vi.fn();
		const { input } = mount(20, 2.5, onChange);

		await type(input, 'heavy');

		expect(onChange).not.toHaveBeenCalled();
	});

	it('silently reverts an emptied field', async () => {
		const onChange = vi.fn();
		const { input } = mount(20, 2.5, onChange);

		await type(input, '');

		expect(onChange).not.toHaveBeenCalled();
	});

	// A no-op focus+blur must not count as "touching" the field: SetRow tracks
	// untouched fields against the current default (e.g. set 1's just-logged
	// numbers), and a stray onChange would permanently detach set 2 from that.
	it('does not fire onChange when focus and blur leave the value unchanged', async () => {
		const onChange = vi.fn();
		const { input } = mount(20, 2.5, onChange);

		await type(input, '20');

		expect(onChange).not.toHaveBeenCalled();
	});
});
