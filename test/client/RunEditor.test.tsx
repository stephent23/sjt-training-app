import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunEditor } from '../../src/client/screens/RunEditor';
import { todayIso } from '../../src/dates';
import type { SessionDetail } from '../../src/types';

// The screen for a run that was never planned — recorded after the fact — and
// for correcting one that was. Everything here is a write the person is making
// deliberately at a keyboard, so unlike the mid-session screens these go
// straight to the network rather than through the offline queue, and a failure
// has to be visible rather than retried silently.

let container: HTMLDivElement | null = null;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Polls rather than guessing a tick count — the session fetch, its json(),
 *  the state set and Preact's render take a different number of turns
 *  depending on which module import warmed the cache first. */
async function waitFor(predicate: () => boolean, what = 'the screen to settle') {
	for (let i = 0; i < 100; i++) {
		if (predicate()) return;
		await tick();
	}
	throw new Error(`timed out waiting for ${what}`);
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function sessionDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
	return {
		session: { id: 7, date: '2026-08-10', kind: 'run', label: 'Long run', status: 'completed', week_number: 3, origin: 'manual' },
		plannedSets: [],
		plannedRun: { id: 4, run_type: 'long', target_minutes: 70, target_km: null, structure_json: null },
		loggedRun: {
			distance_km: 12.5,
			duration_seconds: 3930, // 65:30
			avg_hr: 148,
			max_hr: null,
			avg_cadence_spm: null,
			elevation_gain_m: null,
			aerobic_training_effect: null,
			rpe_1_10: null,
			performed_on: '2026-08-10',
			note: 'Felt strong',
		},
		feedback: null,
		...overrides,
	};
}

function mount(sessionId?: number) {
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<RunEditor sessionId={sessionId} />, container);
	return container;
}

function buttonWith(root: HTMLElement, text: string): HTMLButtonElement {
	const button = [...root.querySelectorAll('button')].find((el) => (el.textContent ?? '').includes(text));
	if (!button) throw new Error(`no button matching ${text}`);
	return button;
}

function maybeButtonWith(root: HTMLElement, text: string): HTMLButtonElement | undefined {
	return [...root.querySelectorAll('button')].find((el) => (el.textContent ?? '').includes(text));
}

function tapButton(root: HTMLElement, text: string): HTMLButtonElement {
	const button = [...root.querySelectorAll<HTMLButtonElement>('.tap-btn')].find((el) =>
		(el.textContent ?? '').toLowerCase().includes(text.toLowerCase()),
	);
	if (!button) throw new Error(`no tap button matching ${text}`);
	return button;
}

/** Deliberately layout-agnostic: the shared run block is a table on Review and
 *  may well be `.field` labels here, so these find the input by the text of the
 *  smallest row/label that wraps it rather than by position or by tag. */
function inputsFor(root: HTMLElement, labelText: string): HTMLInputElement[] {
	const holders = [...root.querySelectorAll<HTMLElement>('tr, label, .field')]
		.filter((el) => (el.textContent ?? '').toLowerCase().includes(labelText.toLowerCase()))
		.filter((el) => el.querySelector('input, textarea') !== null)
		.sort((a, b) => (a.textContent ?? '').length - (b.textContent ?? '').length);
	if (holders.length === 0) throw new Error(`no field labelled ${labelText}`);
	return [...holders[0].querySelectorAll<HTMLInputElement>('input, textarea')];
}

function inputFor(root: HTMLElement, labelText: string): HTMLInputElement {
	return inputsFor(root, labelText)[0];
}

function dateInput(root: HTMLElement): HTMLInputElement {
	const input = root.querySelector<HTMLInputElement>('input[type="date"]');
	if (!input) throw new Error('no date input');
	return input;
}

/** `input`, not `change`: Preact wires onInput, and a change event alone leaves
 *  the component's state on its previous value. */
async function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}

/** Fills the two-box duration row. Minutes first, seconds second. */
async function typeDuration(root: HTMLElement, minutes: string, seconds: string) {
	const [min, sec] = inputsFor(root, 'Duration');
	await type(min, minutes);
	await type(sec, seconds);
}

interface Call {
	url: string;
	method: string;
	body: unknown;
}

function calls(fetchMock: ReturnType<typeof vi.fn>, method?: string): Call[] {
	return fetchMock.mock.calls
		.map(([url, init]) => ({
			url: String(url),
			method: ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase(),
			body: (init as RequestInit | undefined)?.body ? JSON.parse((init as RequestInit).body as string) : undefined,
		}))
		.filter((call) => method === undefined || call.method === method);
}

/** Loads a run for editing and waits for the prefill to land. */
async function mountEdit(detail = sessionDetail()) {
	const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
		if ((init?.method ?? 'GET').toUpperCase() === 'GET') return json(detail);
		return json({ id: detail.session.id });
	});
	vi.stubGlobal('fetch', fetchMock);

	const root = mount(detail.session.id);
	await waitFor(() => inputFor(root, 'Distance').value !== '', 'the run to load');
	return { root, fetchMock };
}

beforeEach(() => {
	vi.restoreAllMocks();
	localStorage.clear();
	location.hash = '';
});

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
	localStorage.clear();
	location.hash = '';
	vi.unstubAllGlobals();
});

describe('RunEditor — adding a run by hand', () => {
	it('starts on today with nothing to delete', () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({})));

		const root = mount();

		expect(dateInput(root).value).toBe(todayIso());
		expect(maybeButtonWith(root, 'Delete this run')).toBeUndefined();
		expect(root.querySelector('.btn-primary')?.textContent).toContain('Save run');
	});

	it('posts one run with exactly what was typed', async () => {
		// The id in the response is what the redirect is built from — a new run
		// has no session id until the server has made one.
		const fetchMock = vi.fn(async () => json({ id: 42 }));
		vi.stubGlobal('fetch', fetchMock);

		const root = mount();
		await type(dateInput(root), '2026-08-21');
		await type(inputFor(root, 'Distance'), '8.2');
		await typeDuration(root, '42', '30');
		tapButton(root, 'tempo').click();
		await tick();

		buttonWith(root, 'Save run').click();
		await waitFor(() => calls(fetchMock, 'POST').length > 0, 'the run to be posted');

		const posted = calls(fetchMock, 'POST');
		expect(posted).toHaveLength(1);
		expect(posted[0].url).toBe('/api/runs');
		expect(posted[0].body).toEqual({
			date: '2026-08-21',
			run_type: 'tempo',
			distance_km: 8.2,
			duration_seconds: 2550,
			avg_hr: null,
			max_hr: null,
			avg_cadence_spm: null,
			elevation_gain_m: null,
			aerobic_training_effect: null,
			rpe_1_10: null,
			note: null,
		});

		await waitFor(() => location.hash === '#/review/42', 'the redirect to the new run');
	});

	it('sends the watch metrics and the note when they are filled in', async () => {
		const fetchMock = vi.fn(async () => json({ id: 42 }));
		vi.stubGlobal('fetch', fetchMock);

		const root = mount();
		await type(inputFor(root, 'Distance'), '10');
		await typeDuration(root, '50', '');
		tapButton(root, 'easy').click();
		await tick();
		await type(inputFor(root, 'Avg HR'), '142');
		const note = root.querySelector('textarea') as HTMLTextAreaElement;
		await type(note as unknown as HTMLInputElement, 'Windy out');

		buttonWith(root, 'Save run').click();
		await waitFor(() => calls(fetchMock, 'POST').length > 0, 'the run to be posted');

		expect(calls(fetchMock, 'POST')[0].body).toMatchObject({
			distance_km: 10,
			duration_seconds: 3000,
			avg_hr: 142,
			max_hr: null,
			note: 'Windy out',
		});
	});

	// The refuse-to-commit rule from ReviewRun, made audible: half a run is not
	// a run, and a run with duration 0 would still count as one to progressRun.
	it('never reaches the network when the duration is missing', async () => {
		const fetchMock = vi.fn(async () => json({ id: 42 }));
		vi.stubGlobal('fetch', fetchMock);

		const root = mount();
		await type(inputFor(root, 'Distance'), '8.2');
		tapButton(root, 'easy').click();
		await tick();

		buttonWith(root, 'Save run').click();
		await waitFor(() => root.querySelector('.error-list') !== null, 'the problems to be listed');

		expect(calls(fetchMock).filter((call) => call.url.includes('/api/runs'))).toHaveLength(0);
		expect(root.querySelectorAll('.error-list li').length).toBeGreaterThan(0);
		expect(root.querySelector('.error-list')!.textContent).toMatch(/duration/i);
		expect(location.hash).toBe('');
	});

	it('shows what the server said when it refuses the run', async () => {
		const fetchMock = vi.fn(async () => json({ error: 'a run is already recorded for that date' }, 400));
		vi.stubGlobal('fetch', fetchMock);

		const root = mount();
		await type(inputFor(root, 'Distance'), '8.2');
		await typeDuration(root, '42', '30');
		tapButton(root, 'easy').click();
		await tick();

		buttonWith(root, 'Save run').click();
		await waitFor(() => root.querySelector('.error-list') !== null, 'the server error to surface');

		expect(root.querySelector('.error-list')!.textContent).toContain('a run is already recorded for that date');
		expect(location.hash).toBe('');
	});

	it('bars a second save while the first is still in flight', async () => {
		let release: (response: Response) => void = () => {};
		const inFlight = new Promise<Response>((resolve) => (release = resolve));
		const fetchMock = vi.fn(() => inFlight);
		vi.stubGlobal('fetch', fetchMock);

		const root = mount();
		await type(inputFor(root, 'Distance'), '8.2');
		await typeDuration(root, '42', '30');
		tapButton(root, 'easy').click();
		await tick();

		buttonWith(root, 'Save run').click();
		await waitFor(() => root.querySelector<HTMLButtonElement>('.btn-primary')?.disabled === true, 'the save button to lock');

		root.querySelector<HTMLButtonElement>('.btn-primary')!.click();
		await tick();
		expect(calls(fetchMock, 'POST')).toHaveLength(1);

		release(json({ id: 42 }));
		await waitFor(() => location.hash === '#/review/42', 'the redirect after the save lands');
	});
});

describe('RunEditor — correcting a recorded run', () => {
	it('prefills every field from the session it was given', async () => {
		const { root } = await mountEdit();

		expect(dateInput(root).value).toBe('2026-08-10');
		expect(inputFor(root, 'Distance').value).toBe('12.5');
		const [minutes, seconds] = inputsFor(root, 'Duration');
		expect(minutes.value).toBe('65');
		expect(seconds.value).toBe('30');
		expect(inputFor(root, 'Avg HR').value).toBe('148');
		expect(inputFor(root, 'Max HR').value).toBe('');
		expect((root.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Felt strong');

		const pressed = [...root.querySelectorAll('.tap-btn[aria-pressed="true"]')];
		expect(pressed).toHaveLength(1);
		expect((pressed[0].textContent ?? '').toLowerCase()).toContain('long');
	});

	it('loads the run it is editing and nothing else', async () => {
		const { fetchMock } = await mountEdit();

		expect(calls(fetchMock, 'GET').map((call) => call.url)).toContain('/api/sessions/7');
	});

	it('puts the edit to the run it is editing rather than posting a second one', async () => {
		const { root, fetchMock } = await mountEdit();

		await type(inputFor(root, 'Distance'), '12.9');
		buttonWith(root, 'Save run').click();
		await waitFor(() => calls(fetchMock, 'PUT').length > 0, 'the edit to be saved');

		expect(calls(fetchMock, 'POST')).toHaveLength(0);
		const put = calls(fetchMock, 'PUT');
		expect(put).toHaveLength(1);
		expect(put[0].url).toBe('/api/runs/7');
		expect(put[0].body).toMatchObject({
			date: '2026-08-10',
			run_type: 'long',
			distance_km: 12.9,
			duration_seconds: 3930,
			avg_hr: 148,
			note: 'Felt strong',
		});

		await waitFor(() => location.hash === '#/review/7', 'the redirect back to the run');
	});

	it('lists the problems instead of saving an edit that empties the distance', async () => {
		const { root, fetchMock } = await mountEdit();

		await type(inputFor(root, 'Distance'), '');
		buttonWith(root, 'Save run').click();
		await waitFor(() => root.querySelector('.error-list') !== null, 'the problems to be listed');

		expect(calls(fetchMock, 'PUT')).toHaveLength(0);
		expect(root.querySelector('.error-list')!.textContent).toMatch(/distance/i);
	});
});

describe('RunEditor — deleting a run', () => {
	// Never window.confirm: it does not exist in the installed PWA's chrome in
	// any form worth trusting, and a native dialog is not something the design
	// system can style. The second click on a button that has visibly changed
	// is the guard.
	it('asks first — one click deletes nothing', async () => {
		const { root, fetchMock } = await mountEdit();
		const confirmSpy = vi.spyOn(window, 'confirm');

		buttonWith(root, 'Delete this run').click();
		await tick();

		expect(calls(fetchMock, 'DELETE')).toHaveLength(0);
		expect(confirmSpy).not.toHaveBeenCalled();
		expect(root.querySelector('.btn-danger')).not.toBeNull();
		expect(location.hash).toBe('');
	});

	it('deletes on the second click and goes back to history', async () => {
		const { root, fetchMock } = await mountEdit();

		buttonWith(root, 'Delete this run').click();
		await tick();
		root.querySelector<HTMLButtonElement>('.btn-danger')!.click();
		await waitFor(() => calls(fetchMock, 'DELETE').length > 0, 'the delete to be sent');

		const deletes = calls(fetchMock, 'DELETE');
		expect(deletes).toHaveLength(1);
		expect(deletes[0].url).toBe('/api/runs/7');

		await waitFor(() => location.hash === '#/history', 'the redirect to history');
	});
});
