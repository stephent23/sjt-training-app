import { render } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinishBar } from '../../src/client/components/FinishBar';

let container: HTMLDivElement | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function mount(status: 'planned' | 'completed' | 'skipped' = 'planned') {
	const onComplete = vi.fn();
	const onSkip = vi.fn();
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<FinishBar status={status} onComplete={onComplete} onSkip={onSkip} />, container);
	return { container, onComplete, onSkip };
}

const button = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement | undefined;

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
});

describe('FinishBar', () => {
	it('completes in one tap and sits in the sticky action bar', () => {
		const { container, onComplete } = mount();
		expect(container.querySelector('.run-actionbar')).not.toBeNull();
		button(container, 'Mark complete')!.click();
		expect(onComplete).toHaveBeenCalled();
	});

	it('asks before skipping, and Keep it backs out', async () => {
		const { container, onSkip } = mount();
		button(container, 'Mark skipped')!.click();
		await tick();
		expect(container.textContent).toContain('Skip this session?');
		expect(onSkip).not.toHaveBeenCalled();

		button(container, 'Keep it')!.click();
		await tick();
		expect(button(container, 'Mark skipped')).toBeDefined();
		expect(onSkip).not.toHaveBeenCalled();
	});

	it('skips only on "Yes, skip"', async () => {
		const { container, onSkip } = mount();
		button(container, 'Mark skipped')!.click();
		await tick();
		button(container, 'Yes, skip')!.click();
		expect(onSkip).toHaveBeenCalledTimes(1);
	});

	it('shows the finished state disabled', () => {
		expect(button(mount('completed').container, 'Completed')!.disabled).toBe(true);
	});
});
