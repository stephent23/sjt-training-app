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

	it('ignores completed sessions when looking for what to do next', async () => {
		await insertSession({ date: todayIso(), label: 'Already done', status: 'completed' });
		const upcomingId = await insertSession({ date: '2026-12-31', label: 'Next up' });

		const body = await fetchToday();
		expect(body.session?.id).toBe(upcomingId);
	});

	it('falls back to the most recent session when everything is completed', async () => {
		await insertSession({ date: '2026-01-01', label: 'Oldest', status: 'completed' });
		const latestId = await insertSession({ date: '2026-06-01', label: 'Most recent', status: 'completed' });

		const body = await fetchToday();
		expect(body.session?.id).toBe(latestId);
	});
});
