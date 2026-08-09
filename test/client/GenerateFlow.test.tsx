import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenerateFlow } from '../../src/client/components/GenerateFlow';

// Step 1's download used to be a bare <a href="/api/..." download>, which in the
// installed standalone PWA saved a 0-byte file and reported nothing. These
// assert the button actually produces the export bytes, and that a failing
// export is surfaced instead of silently writing an empty file.

let container: HTMLDivElement | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function waitFor(predicate: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error('timed out');
}

/** jsdom implements neither createObjectURL nor anchor-click downloads, so we
 *  record the Blob the anchor was pointed at and read it back. */
function captureDownload() {
	const saved: { blob: Blob | null; filename: string | null } = { blob: null, filename: null };
	const urls = new Map<string, Blob>();

	vi.stubGlobal('URL', {
		...URL,
		createObjectURL: vi.fn((blob: Blob) => {
			const url = `blob:mock/${urls.size}`;
			urls.set(url, blob);
			return url;
		}),
		revokeObjectURL: vi.fn(),
	});

	const originalClick = HTMLAnchorElement.prototype.click;
	vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
		saved.blob = urls.get(this.getAttribute('href') ?? '') ?? null;
		saved.filename = this.getAttribute('download');
	});

	return { saved, restore: () => (HTMLAnchorElement.prototype.click = originalClick) };
}

function mount() {
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<GenerateFlow onImported={() => {}} />, container);
	return container;
}

/** Deliberately tag-agnostic — an <a href download> and a <button> are both
 *  legitimate markup for this control, so the test pins the behaviour (real
 *  bytes reach the download) rather than the element it's implemented with. */
function downloadControl(root: HTMLElement): HTMLElement {
	const control = [...root.querySelectorAll('button, a')].find((el) => (el.textContent ?? '').includes('Download your training data'));
	if (!control) throw new Error('download control not found');
	return control as HTMLElement;
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

describe('Generate — step 1 download', () => {
	it('saves the export payload rather than an empty file', async () => {
		const payload = {
			deterministicProposal: { weeks: [{ week_number: 2, sessions: [] }] },
			speculativeFromWeek: 2,
			reasons: {},
			historyWindow: { loggedSets: [], loggedRuns: [] },
			skippedSessions: [],
			goals: '',
			daysPerWeek: 5,
			exerciseCatalogue: [],
			painFlags: { shoulder: false, back: false },
		};
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })),
		);
		const { saved, restore } = captureDownload();

		try {
			const root = mount();
			downloadControl(root).click();
			await waitFor(() => saved.blob !== null);

			expect(saved.filename).toBe('training-export.json');
			const text = await saved.blob!.text();
			expect(text.trim()).not.toBe('');
			expect(JSON.parse(text)).toEqual(payload);
		} finally {
			restore();
		}
	});

	it('requests the number of weeks shown in the field', async () => {
		const fetchMock = vi.fn(async () => new Response('{"weeks":[]}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const { saved, restore } = captureDownload();

		try {
			const root = mount();
			const input = root.querySelector('input[type="number"]') as HTMLInputElement;
			input.value = '4';
			input.dispatchEvent(new Event('input', { bubbles: true }));
			await tick();

			downloadControl(root).click();
			await waitFor(() => saved.blob !== null);

			expect(fetchMock).toHaveBeenCalledWith('/api/generator/export?weeks=4');
		} finally {
			restore();
		}
	});

	it('shows an error instead of saving a blank file when the export fails', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
		const { saved, restore } = captureDownload();

		try {
			const root = mount();
			downloadControl(root).click();
			await waitFor(() => root.querySelector('.eyebrow--accent') !== null);

			expect(saved.blob).toBeNull();
			expect(root.querySelector('.eyebrow--accent')!.textContent).toContain('500');
		} finally {
			restore();
		}
	});

	it('shows an error instead of saving a blank file when the export body is empty', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));
		const { saved, restore } = captureDownload();

		try {
			const root = mount();
			downloadControl(root).click();
			await waitFor(() => root.querySelector('.eyebrow--accent') !== null);

			expect(saved.blob).toBeNull();
			expect(root.querySelector('.eyebrow--accent')!.textContent).toContain('empty');
		} finally {
			restore();
		}
	});
});
