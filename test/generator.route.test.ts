import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { MultiWeekProposalInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession } from './fixtures';

function postJson(url: string, body?: unknown) {
	return SELF.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function setDaysPerWeek(n: number) {
	await SELF.fetch('https://training-app.test/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ days_per_week: n }),
	});
}

// One lift session in week 1, holding at its prescribed weight (reps land in
// range without maxing out) — days_per_week is trimmed to 1 to match, so the
// deterministic proposal validates cleanly without needing a full 5-day week.
async function seedOneSessionWeek() {
	const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
	const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
	await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
	await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: '2026-08-03' });
	await setDaysPerWeek(1);
	return { exerciseId, sessionId };
}

describe('GET /export', () => {
	it('returns 3 weeks when ?weeks=3, with correct +7/+14 date shifts', async () => {
		await seedOneSessionWeek();

		const res = await SELF.fetch('https://training-app.test/api/generator/export?weeks=3');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { deterministicProposal: MultiWeekProposalInput; speculativeFromWeek: number };

		expect(body.deterministicProposal.weeks).toHaveLength(3);
		const [week1, week2, week3] = body.deterministicProposal.weeks;
		expect(week1.week_number).toBe(2);
		expect(week2.week_number).toBe(3);
		expect(week3.week_number).toBe(4);
		expect(week1.sessions[0].date).toBe('2026-08-10');
		expect(week2.sessions[0].date).toBe('2026-08-17');
		expect(week3.sessions[0].date).toBe('2026-08-24');
		expect(body.speculativeFromWeek).toBe(2);
	});

	it('clamps an out-of-range ?weeks=50 to the default of 1 week (not 50, not an error)', async () => {
		await seedOneSessionWeek();

		const res = await SELF.fetch('https://training-app.test/api/generator/export?weeks=50');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { deterministicProposal: MultiWeekProposalInput };
		expect(body.deterministicProposal.weeks).toHaveLength(1);
	});

	it('defaults to 1 week when ?weeks is omitted', async () => {
		await seedOneSessionWeek();

		const res = await SELF.fetch('https://training-app.test/api/generator/export');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { deterministicProposal: MultiWeekProposalInput };
		expect(body.deterministicProposal.weeks).toHaveLength(1);
	});
});

describe('generator export -> import -> pending -> accept/reject flow', () => {
	it('export -> import -> pending -> accept (multi-week) lands real sessions across all N weeks with incrementing week_number', async () => {
		await seedOneSessionWeek();

		const exportRes = await SELF.fetch('https://training-app.test/api/generator/export?weeks=3');
		expect(exportRes.status).toBe(200);
		const exportBody = (await exportRes.json()) as { deterministicProposal: MultiWeekProposalInput };
		expect(exportBody.deterministicProposal.weeks).toHaveLength(3);

		const importRes = await postJson('https://training-app.test/api/generator/import', exportBody.deterministicProposal);
		expect(importRes.status).toBe(200);
		const { id } = (await importRes.json()) as { id: number };
		expect(typeof id).toBe('number');

		const pendingRes = await SELF.fetch('https://training-app.test/api/generator/pending');
		const pendingBody = (await pendingRes.json()) as {
			pending: { id: number; first_week_number: number; week_count: number; plan: MultiWeekProposalInput } | null;
		};
		expect(pendingBody.pending?.id).toBe(id);
		expect(pendingBody.pending?.first_week_number).toBe(2);
		expect(pendingBody.pending?.week_count).toBe(3);
		expect(pendingBody.pending?.plan.weeks).toHaveLength(3);

		const acceptRes = await postJson(`https://training-app.test/api/generator/${id}/accept`);
		expect(acceptRes.status).toBe(200);

		const sessionsRes = await SELF.fetch('https://training-app.test/api/sessions?from=2026-01-01&to=2026-12-31&limit=200');
		const sessionsBody = (await sessionsRes.json()) as { sessions: { week_number: number; date: string; label: string }[] };

		for (const [weekNumber, date] of [
			[2, '2026-08-10'],
			[3, '2026-08-17'],
			[4, '2026-08-24'],
		] as const) {
			const matches = sessionsBody.sessions.filter((s) => s.week_number === weekNumber);
			expect(matches).toHaveLength(1);
			expect(matches[0].date).toBe(date);
			expect(matches[0].label).toBe('Lift A');
		}

		const nowPendingRes = await SELF.fetch('https://training-app.test/api/generator/pending');
		expect(((await nowPendingRes.json()) as { pending: unknown }).pending).toBeNull();
	});

	it('reject leaves no new session/planned_set rows behind', async () => {
		await seedOneSessionWeek();
		const exportBody = (await (await SELF.fetch('https://training-app.test/api/generator/export?weeks=2')).json()) as {
			deterministicProposal: MultiWeekProposalInput;
		};
		const { id } = (await (await postJson('https://training-app.test/api/generator/import', exportBody.deterministicProposal)).json()) as { id: number };

		const rejectRes = await postJson(`https://training-app.test/api/generator/${id}/reject`);
		expect(rejectRes.status).toBe(200);

		const pendingRes = await SELF.fetch('https://training-app.test/api/generator/pending');
		expect(((await pendingRes.json()) as { pending: unknown }).pending).toBeNull();

		const sessionsRes = await SELF.fetch('https://training-app.test/api/sessions?from=2026-01-01&to=2026-12-31&limit=200');
		const sessionsBody = (await sessionsRes.json()) as { sessions: { week_number: number }[] };
		expect(sessionsBody.sessions.filter((s) => s.week_number === 2 || s.week_number === 3)).toHaveLength(0);
	});

	it('rejects a second import while one is already pending with a 422', async () => {
		await seedOneSessionWeek();
		const exportBody = (await (await SELF.fetch('https://training-app.test/api/generator/export')).json()) as {
			deterministicProposal: MultiWeekProposalInput;
		};

		const first = await postJson('https://training-app.test/api/generator/import', exportBody.deterministicProposal);
		expect(first.status).toBe(200);

		const second = await postJson('https://training-app.test/api/generator/import', exportBody.deterministicProposal);
		expect(second.status).toBe(422);
		const body = (await second.json()) as { error: string };
		expect(body.error).toMatch(/already pending/);
	});

	it('accept/reject 404 for an id with no pending row', async () => {
		const acceptRes = await postJson('https://training-app.test/api/generator/999999/accept');
		expect(acceptRes.status).toBe(404);

		const rejectRes = await postJson('https://training-app.test/api/generator/999999/reject');
		expect(rejectRes.status).toBe(404);
	});
});
