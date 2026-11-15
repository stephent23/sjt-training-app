import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixItMessage, PlanRequest } from '../../src/client/components/GenerateFlow';

let container: HTMLDivElement | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out');
}

function mount(onImported: () => void = () => {}, weeks = 6, startDate = '2026-08-17', asked = false, onAsked: () => void = () => {}) {
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<PlanRequest weeks={weeks} startDate={startDate} asked={asked} onAsked={onAsked} onImported={onImported} />, container);
	return container;
}

function buttonWith(root: HTMLElement, text: string): HTMLButtonElement {
	const button = [...root.querySelectorAll('button')].find((el) => (el.textContent ?? '').includes(text));
	if (!button) throw new Error(`no button matching ${text}`);
	return button;
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
	vi.unstubAllGlobals();
});

const exportPayload = { goals: 'Half marathon', goalTags: ['build_strength'], deterministicProposal: { weeks: [] } };
const okExport = () => vi.fn(async () => new Response(JSON.stringify(exportPayload), { status: 200 }));

describe('Step 1 — ask Claude', () => {
	it('is "Copy for Claude" when files cannot be shared, and makes step 2 the primary once done', async () => {
		vi.stubGlobal('fetch', okExport());
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, canShare: undefined, share: undefined, clipboard: { writeText } });
		const onAsked = vi.fn();

		const root = mount(() => {}, 6, '2026-08-17', false, onAsked);
		expect(root.querySelector('.btn-primary')!.textContent).toContain('Copy for Claude');
		buttonWith(root, 'Copy for Claude').click();
		await waitFor(() => onAsked.mock.calls.length > 0);
		expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain('MY TRAINING DATA');
		expect(root.querySelector('[role="status"]')!.textContent).toContain('Copied');
	});

	it('shows step 2 as the primary action once step 1 is done, and keeps Open Claude under More options', () => {
		vi.stubGlobal('fetch', okExport());
		const root = mount(() => {}, 6, '2026-08-17', true);
		expect(root.querySelector('.btn-primary')!.textContent).toContain('Paste Claude');
		expect(root.querySelector('details a[href="https://claude.ai/new"]')!.getAttribute('target')).toBe('_blank');
	});

	it('shares the data as a file plus the prompt where the browser can', async () => {
		vi.stubGlobal('fetch', okExport());
		const share = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });

		const root = mount();
		buttonWith(root, 'Share with Claude').click();
		await waitFor(() => share.mock.calls.length > 0);

		const arg = (share.mock.calls[0] as unknown as [{ files: File[]; text: string }])[0];
		expect(arg.files[0].name).toBe('training-export.json');
		expect(arg.text).toContain('HARD RULES');
	});
});

describe('Step 2 — paste the answer', () => {
	const plan = { weeks: [{ week_number: 1, sessions: [] }] };

	it('imports straight from the clipboard', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":1}', { status: 200 })));
		vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => JSON.stringify(plan), writeText: vi.fn() } });
		const onImported = vi.fn();

		const root = mount(onImported);
		buttonWith(root, 'Paste Claude').click();
		await waitFor(() => onImported.mock.calls.length > 0);
	});

	it('opens the textarea when the clipboard cannot be read', async () => {
		vi.stubGlobal('fetch', okExport());
		vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => Promise.reject(new Error('denied')) } });

		const root = mount();
		buttonWith(root, 'Paste Claude').click();
		await waitFor(() => root.textContent!.includes('Could not read the clipboard'));
		expect((root.querySelector('details') as HTMLDetailsElement).open).toBe(true);
	});

	it('copies the errors wrapped in a fix-it message', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) =>
				url.includes('/import') ? new Response(JSON.stringify({ errors: ['bad exercise_id 9'] }), { status: 422 }) : new Response(JSON.stringify(exportPayload), { status: 200 }),
			),
		);
		vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => JSON.stringify(plan), writeText } });

		const root = mount();
		buttonWith(root, 'Paste Claude').click();
		await waitFor(() => root.querySelector('.error-list') !== null);
		buttonWith(root, 'Copy errors for Claude').click();
		await waitFor(() => writeText.mock.calls.length > 0);

		expect((writeText.mock.calls[0] as unknown as [string])[0]).toBe(fixItMessage(['bad exercise_id 9']));
		expect(fixItMessage(['x'])).toContain('- x');
	});
});
