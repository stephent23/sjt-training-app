import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addDaysIso } from '../src/dates';
import type { MultiWeekProposalInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession, todayIso } from './fixtures';

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
//
// Dated "yesterday" relative to the real clock (this file goes through
// SELF.fetch, so the route reads todayIso() for real — see the comment at
// "carries a today/weekStartDate anchor" below). A one-day-old anchor is
// recent enough that a single +7 shift always lands the next proposed week
// safely after today, whatever today's real date turns out to be.
async function seedOneSessionWeek() {
	const anchorDate = addDaysIso(todayIso(), -1);
	const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
	const sessionId = await insertSession({ date: anchorDate, label: 'Lift A', week_number: 1 });
	await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
	await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: anchorDate });
	await setDaysPerWeek(1);
	return { exerciseId, sessionId, anchorDate };
}

describe('GET /export', () => {
	// Deliberately not pinned to literal dates — this route reads the clock, so
	// the assertions below check relationships (day count ahead of the anchor,
	// weekday preserved, strictly after today) rather than hardcoded strings
	// that would silently rot as the real calendar moves past them.
	it('returns 3 weeks when ?weeks=3, with correct +7/+14 date shifts', async () => {
		const { anchorDate } = await seedOneSessionWeek();
		const today = todayIso();

		const res = await SELF.fetch('https://training-app.test/api/generator/export?weeks=3');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { deterministicProposal: MultiWeekProposalInput; speculativeFromWeek: number };

		expect(body.deterministicProposal.weeks).toHaveLength(3);
		const [week1, week2, week3] = body.deterministicProposal.weeks;
		expect(week1.week_number).toBe(2);
		expect(week2.week_number).toBe(3);
		expect(week3.week_number).toBe(4);

		const week1Date = week1.sessions[0].date;
		const week2Date = week2.sessions[0].date;
		const week3Date = week3.sessions[0].date;

		expect(week1Date).toBe(addDaysIso(anchorDate, 7));
		expect(week2Date).toBe(addDaysIso(anchorDate, 14));
		expect(week3Date).toBe(addDaysIso(anchorDate, 21));

		// Every proposed date lands strictly after today, and each week is
		// exactly 7 days after the last (the day-of-week pattern preserved).
		expect(week1Date > today).toBe(true);
		expect(new Date(`${week1Date}T00:00:00Z`).getUTCDay()).toBe(new Date(`${anchorDate}T00:00:00Z`).getUTCDay());
		expect(addDaysIso(week1Date, 7)).toBe(week2Date);
		expect(addDaysIso(week2Date, 7)).toBe(week3Date);

		expect(body.speculativeFromWeek).toBe(2);
	});

	it('clamps an out-of-range ?weeks=50 to the default of 1 week (not 50, not an error)', async () => {
		await seedOneSessionWeek();

		const res = await SELF.fetch('https://training-app.test/api/generator/export?weeks=50');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { deterministicProposal: MultiWeekProposalInput };
		expect(body.deterministicProposal.weeks).toHaveLength(1);
	});

	// The anchor exists because a cold-start export (no sessions at all) used to
	// contain no date anywhere: empty weeks, empty history, empty skipped list.
	// An assistant asked to write a plan from scratch had to invent dates, and
	// isRealIsoDate happily accepts any real date — so a plan dated last year
	// imported cleanly and then never matched a Today/Plan query again.
	it('carries a today/weekStartDate anchor for a plan written from scratch', async () => {
		await seedOneSessionWeek();

		const res = await SELF.fetch('https://training-app.test/api/generator/export');
		const body = (await res.json()) as { today: string; weekStartDate: string };

		expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(body.weekStartDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		// Deliberately not pinned to literal dates — this route reads the clock.
		expect(body.weekStartDate >= body.today).toBe(true);
		expect(new Date(`${body.weekStartDate}T00:00:00Z`).getUTCDay()).toBe(1);
	});

	it('anchors a cold-start export too, where no other date exists in the payload', async () => {
		const res = await SELF.fetch('https://training-app.test/api/generator/export?weeks=2');
		const body = (await res.json()) as { today: string; weekStartDate: string; deterministicProposal: MultiWeekProposalInput };

		expect(body.deterministicProposal.weeks.every((w) => w.sessions.length === 0)).toBe(true);
		expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(new Date(`${body.weekStartDate}T00:00:00Z`).getUTCDay()).toBe(1);
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
		const { anchorDate } = await seedOneSessionWeek();

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

		// Deliberately not range-limited to a literal year — this route reads the
		// clock, and the anchor is relative to whatever "today" really is when
		// the suite runs.
		const sessionsRes = await SELF.fetch('https://training-app.test/api/sessions?limit=200');
		const sessionsBody = (await sessionsRes.json()) as { sessions: { week_number: number; date: string; label: string }[] };

		for (const [weekNumber, daysAhead] of [
			[2, 7],
			[3, 14],
			[4, 21],
		] as const) {
			const matches = sessionsBody.sessions.filter((s) => s.week_number === weekNumber);
			expect(matches).toHaveLength(1);
			expect(matches[0].date).toBe(addDaysIso(anchorDate, daysAhead));
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

		const sessionsRes = await SELF.fetch('https://training-app.test/api/sessions?limit=200');
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
		const body = (await second.json()) as { error: string; errors: string[] };
		expect(body.error).toMatch(/already pending/);
		expect(body.errors).toEqual([expect.stringMatching(/already pending/)]);
	});

	// Asking the assistant to fix a rejected plan and pasting the corrected one
	// back is the normal path, and it always arrives while the first is still
	// pending. Explicit rather than automatic, so a double-import can't quietly
	// discard the plan you were reading.
	it('replaces the pending plan when asked to explicitly', async () => {
		await seedOneSessionWeek();
		const exportBody = (await (await SELF.fetch('https://training-app.test/api/generator/export')).json()) as {
			deterministicProposal: MultiWeekProposalInput;
		};

		const { id: firstId } = (await (await postJson('https://training-app.test/api/generator/import', exportBody.deterministicProposal)).json()) as { id: number };

		const replaced = await postJson('https://training-app.test/api/generator/import?replace=true', exportBody.deterministicProposal);
		expect(replaced.status).toBe(200);
		const { id: secondId } = (await replaced.json()) as { id: number };
		expect(secondId).not.toBe(firstId);

		// Exactly one pending plan, and it is the new one.
		const pending = (await (await SELF.fetch('https://training-app.test/api/generator/pending')).json()) as { pending: { id: number } | null };
		expect(pending.pending?.id).toBe(secondId);
	});

	it('surfaces validation problems one per entry, not as one joined blob', async () => {
		await seedOneSessionWeek();

		const res = await postJson('https://training-app.test/api/generator/import', {
			weeks: [{ week_number: 2, sessions: [{ date: 'whenever', kind: 'swim', label: '', plannedSets: [], plannedRun: null }] }],
		});
		expect(res.status).toBe(422);
		const body = (await res.json()) as { errors: string[] };
		expect(body.errors.length).toBeGreaterThan(1);
	});

	it('accept/reject 404 for an id with no pending row', async () => {
		const acceptRes = await postJson('https://training-app.test/api/generator/999999/accept');
		expect(acceptRes.status).toBe(404);

		const rejectRes = await postJson('https://training-app.test/api/generator/999999/reject');
		expect(rejectRes.status).toBe(404);
	});
});
