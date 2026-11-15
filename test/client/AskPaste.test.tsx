import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AskStep, fixItMessage, PasteStep } from '../../src/client/components/GenerateFlow';

let container: HTMLDivElement | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out');
}

function mount(onImported: () => void = () => {}, weeks = 6, startDate = '2026-08-17') {
	container = document.createElement('div');
	document.body.appendChild(container);
	render(
		<>
			<AskStep weeks={weeks} startDate={startDate} onNext={() => {}} />
			<PasteStep onImported={onImported} />
		</>,
		container,
	);
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

describe('Ask step', () => {
	it('shows what is being sent as chips', async () => {
		vi.stubGlobal('fetch', okExport());
		const root = mount();
		await waitFor(() => (root.querySelector('.chip-summary')?.textContent ?? '').includes('2 goals'));
		const chips = root.querySelector('.chip-summary')!.textContent!;
		expect(chips).toContain('6 weeks');
		expect(chips).toContain('17 Aug');
	});

	it('makes copy-it-all the main action when files cannot be shared, with a link to Claude', async () => {
		vi.stubGlobal('fetch', okExport());
		const root = mount();
		expect(root.querySelector('.btn-primary')!.textContent).toContain('Copy prompt + data');
		expect(root.querySelector('a[href="https://claude.ai/new"]')!.getAttribute('target')).toBe('_blank');
	});

	it('shares the data as a file plus the prompt where the browser can', async () => {
		vi.stubGlobal('fetch', okExport());
		const share = vi.fn(async () => {});
		vi.stubGlobal('navigator', { ...navigator, canShare: () => true, share });

		const root = mount();
		await waitFor(() => (root.querySelector('.chip-summary')?.textContent ?? '').includes('goals'));
		buttonWith(root, 'Share with Claude').click();
		await waitFor(() => share.mock.calls.length > 0);

		const arg = (share.mock.calls[0] as unknown as [{ files: File[]; text: string }])[0];
		expect(arg.files[0].name).toBe('training-export.json');
		expect(arg.text).toContain('HARD RULES');
	});
});

describe('Paste step', () => {
	const plan = { weeks: [{ week_number: 1, sessions: [] }] };

	it('imports straight from the clipboard', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"id":1}', { status: 200 })));
		vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => JSON.stringify(plan), writeText: vi.fn() } });
		const onImported = vi.fn();

		const root = mount(onImported);
		buttonWith(root, 'Paste from clipboard').click();
		await waitFor(() => onImported.mock.calls.length > 0);
	});

	it('opens the textarea when the clipboard cannot be read', async () => {
		vi.stubGlobal('fetch', okExport());
		vi.stubGlobal('navigator', { ...navigator, clipboard: { readText: async () => Promise.reject(new Error('denied')) } });

		const root = mount();
		buttonWith(root, 'Paste from clipboard').click();
		await waitFor(() => root.textContent!.includes('Could not read the clipboard'));
		const details = root.querySelectorAll('details');
		expect((details[details.length - 1] as HTMLDetailsElement).open).toBe(true);
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
		buttonWith(root, 'Paste from clipboard').click();
		await waitFor(() => root.querySelector('.error-list') !== null);
		buttonWith(root, 'Copy errors for Claude').click();
		await waitFor(() => writeText.mock.calls.length > 0);

		expect((writeText.mock.calls[0] as unknown as [string])[0]).toBe(fixItMessage(['bad exercise_id 9']));
		expect(fixItMessage(['x'])).toContain('- x');
	});
});
