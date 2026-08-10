import { render } from 'preact';
import { afterEach, describe, expect, it } from 'vitest';
import { SessionList } from '../../src/client/components/SessionRow';
import type { SessionSummary } from '../../src/types';

// Plan can hold twelve generated weeks at once, which is an enormous scroll.
// Collapsing is opt-in: Today only ever has one week, and History is entirely
// past, where "the current week" means nothing.

let container: HTMLDivElement | null = null;

/** Preact re-renders off a microtask, so a click needs one turn to land. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
	if (container) {
		render(null, container);
		container.remove();
		container = null;
	}
});

function session(id: number, weekNumber: number, overrides: Partial<SessionSummary> = {}): SessionSummary {
	return {
		id,
		date: `2026-08-${String(id).padStart(2, '0')}`,
		kind: 'lift',
		label: `Session ${id}`,
		status: 'planned',
		week_number: weekNumber,
		exercise_count: 5,
		planned_set_count: 15,
		logged_set_count: 0,
		run_type: null,
		target_minutes: null,
		target_km: null,
		has_logged_run: false,
		logged_distance_km: null,
		logged_duration_seconds: null,
		...overrides,
	};
}

function mount(sessions: SessionSummary[], collapsible: boolean) {
	container = document.createElement('div');
	document.body.appendChild(container);
	render(<SessionList sessions={sessions} linkFor={(s) => `#/preview/${s.id}`} emptyMessage="Nothing planned." collapsible={collapsible} />, container);
	return container;
}

const twoWeeks = [session(3, 1), session(4, 1), session(10, 2), session(11, 2)];

describe('SessionList — collapsible weeks', () => {
	it('shows every week expanded when not collapsible', () => {
		const root = mount(twoWeeks, false);
		expect(root.querySelectorAll('.plan-row-title')).toHaveLength(4);
		expect(root.querySelectorAll('button[aria-expanded]')).toHaveLength(0);
	});

	it('opens the current week and folds the rest away', () => {
		const root = mount(twoWeeks, true);
		const headers = [...root.querySelectorAll('button[aria-expanded]')];

		expect(headers).toHaveLength(2);
		expect(headers[0].getAttribute('aria-expanded')).toBe('true');
		expect(headers[1].getAttribute('aria-expanded')).toBe('false');
		// Week 1's two sessions, plus the two week headers, and nothing from week 2.
		expect(root.textContent).toContain('Session 3');
		expect(root.textContent).not.toContain('Session 10');
	});

	it('says what is inside a week that has been folded away', () => {
		const root = mount([session(3, 1), session(10, 2), session(11, 2, { kind: 'run' })], true);
		const headers = [...root.querySelectorAll('button[aria-expanded]')];
		expect(headers[1].textContent).toContain('2 sessions · 1 lift, 1 run');
	});

	it('opens a later week without closing the current one', async () => {
		const root = mount(twoWeeks, true);
		const headers = [...root.querySelectorAll('button[aria-expanded]')] as HTMLButtonElement[];

		headers[1].click();
		await tick();

		expect(root.textContent).toContain('Session 3');
		expect(root.textContent).toContain('Session 10');
	});

	it('lets the current week be folded shut too', async () => {
		const root = mount(twoWeeks, true);
		([...root.querySelectorAll('button[aria-expanded]')][0] as HTMLButtonElement).click();
		await tick();

		expect(root.textContent).not.toContain('Session 3');
	});

	it('still shows the empty message', () => {
		const root = mount([], true);
		expect(root.querySelector('.empty-state')?.textContent).toBe('Nothing planned.');
	});
});
