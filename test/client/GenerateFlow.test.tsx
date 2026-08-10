import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { describeExport, GenerateFlow } from '../../src/client/components/GenerateFlow';

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

function mount(onImported: () => void = () => {}) {
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<GenerateFlow onImported={onImported} />, container);
	return container;
}

function buttonWith(root: HTMLElement, text: string): HTMLButtonElement {
	const button = [...root.querySelectorAll('button')].find((el) => (el.textContent ?? '').includes(text));
	if (!button) throw new Error(`no button matching ${text}`);
	return button;
}

/** Pastes into the fallback textarea and imports. The file picker can't be
 * driven from jsdom (a FileList is not constructible), and both paths run the
 * same submit(), so this exercises the shared code. */
async function pasteAndImport(root: HTMLElement, text: string) {
	root.querySelector('details.disclosure:last-of-type')?.setAttribute('open', '');
	const textarea = root.querySelector('textarea') as HTMLTextAreaElement;
	textarea.value = text;
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
	buttonWith(root, 'Import').click();
	await tick();
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

// The import path had no coverage at all: the component did a bare JSON.parse
// of the paste, so the prompt's own "explain, then give the JSON" instruction
// produced an answer that could never be imported.
describe('Generate — step 3 import', () => {
	const plan = { weeks: [{ week_number: 2, sessions: [] }] };

	it('finds the plan inside a reply that explains itself first', async () => {
		const fetchMock = vi.fn(async () => new Response('{"id":1}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const onImported = vi.fn();

		const root = mount(onImported);
		await pasteAndImport(root, `Here's what I changed.\n\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``);
		await waitFor(() => onImported.mock.calls.length > 0);

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('/api/generator/import');
		expect(JSON.parse(init.body as string)).toEqual(plan);
	});

	it('lists each validation problem separately rather than as one blob', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: 'a; b', errors: ['bad exercise_id 9', 'session count is wrong'] }), { status: 422 })),
		);

		const root = mount();
		await pasteAndImport(root, JSON.stringify(plan));
		await waitFor(() => root.querySelector('.error-list') !== null);

		expect(root.querySelectorAll('.error-list li')).toHaveLength(2);
	});

	it('offers to replace rather than a trip back to the assistant when one is already pending', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ errors: ['A plan is already pending review — accept or reject it first.'] }), { status: 422 })),
		);

		const root = mount();
		await pasteAndImport(root, JSON.stringify(plan));
		await waitFor(() => root.querySelector('.error-list') !== null);

		expect(buttonWith(root, 'Replace the pending plan')).toBeTruthy();
	});

	it('never reaches the network when the reply has no plan in it', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const root = mount();
		await pasteAndImport(root, "Sure! I'd be happy to help with your training.");
		await waitFor(() => root.querySelector('.error-list') !== null);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(root.querySelector('.error-list')!.textContent).toContain('find any JSON');
	});
});

describe('describeExport', () => {
	it('says a plan is being written from scratch when there is no history', () => {
		const text = describeExport({ deterministicProposal: { weeks: [{ week_number: 1, sessions: [] }] }, weekStartDate: '2026-08-10' });
		expect(text).toContain('from scratch');
		expect(text).toContain('2026-08-10');
	});

	it('calls out a week that exists but has nothing logged against it', () => {
		const text = describeExport({
			deterministicProposal: { weeks: [{ week_number: 2, sessions: [{ date: '2026-08-10', kind: 'lift', label: 'A', plannedSets: [], plannedRun: null }] }] },
			historyWindow: { loggedSets: [], loggedRuns: [] },
		});
		expect(text).toContain('Nothing logged yet');
	});

	it('counts what has actually been logged', () => {
		const text = describeExport({
			deterministicProposal: { weeks: [{ week_number: 2, sessions: [{ date: '2026-08-10', kind: 'lift', label: 'A', plannedSets: [], plannedRun: null }] }] },
			historyWindow: {
				loggedSets: [{ session_id: 1, exercise_id: 1, set_index: 1, weight_kg: 20, reps: 8, rir: 2, rest_taken_seconds: null, performed_on: '2026-08-03' }],
				loggedRuns: [],
			},
		});
		expect(text).toBe('1 sets and 0 runs logged in the last two weeks.');
	});
});
