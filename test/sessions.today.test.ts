import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SessionDetail } from '../src/types';
import { insertSession, todayIso } from './fixtures';

async function fetchToday() {
	const res = await SELF.fetch('https://training-app.test/api/sessions/today');
	return (await res.json()) as SessionDetail | { session: null };
}

describe('GET /api/sessions/today', () => {
	it('returns session: null when nothing has been planned', async () => {
		expect(await fetchToday()).toEqual({ session: null });
	});

	it('prefers a planned session dated today over a future one', async () => {
		await insertSession({ date: '2026-12-25', label: 'Christmas lift' });
		const todayId = await insertSession({ date: todayIso(), label: "Today's lift" });

		const body = await fetchToday();
		expect(body.session?.id).toBe(todayId);
	});

	it('falls back to the nearest upcoming planned session when nothing is planned for today', async () => {
		const soonId = await insertSession({ date: '2026-12-20', label: 'Soon' });
		await insertSession({ date: '2026-12-25', label: 'Later' });

		const body = await fetchToday();
		expect(body.session?.id).toBe(soonId);
	});

	it('still shows a completed session dated today, rather than skipping ahead to a future one', async () => {
		// A day you've already finished should show a "tap to review" recap,
		// not silently jump to something else — Today.tsx already renders a
		// completed-today session that way; the route needs to actually return it.
		const doneId = await insertSession({ date: todayIso(), label: 'Already done', status: 'completed' });
		await insertSession({ date: '2026-12-31', label: 'Next up' });

		const body = await fetchToday();
		expect(body.session?.id).toBe(doneId);
	});

	it('returns session: null when everything is in the past and done, rather than re-showing a stale session', async () => {
		// Previously this fell back to "the most recent session of any status,"
		// which could re-surface something completed weeks ago as if it were
		// still relevant. Nothing today and nothing planned ahead should read
		// as a genuine rest day / all caught up, not a stale recap.
		await insertSession({ date: '2026-01-01', label: 'Oldest', status: 'completed' });
		await insertSession({ date: '2026-06-01', label: 'Most recent', status: 'completed' });

		expect(await fetchToday()).toEqual({ session: null });
	});
});
