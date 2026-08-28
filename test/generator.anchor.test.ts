// buildExportContext used to anchor its two-week history window on
// `SELECT MAX(week_number) FROM sessions` — the newest *scheduled* week, not
// the newest *logged* one. Multi-week import (accepting an N-week plan
// inserts weeks maxWeekNumber+1..+N as unlogged 'planned' rows in one batch)
// makes those two numbers diverge routinely. Every fixture in the other
// generator test files seeds exactly one past-dated week 1, so MAX(week_number)
// happens to equal the right answer there and none of this shows up.
//
// These tests seed more than one week (or seed a week whose sessions were
// never logged) so the divergence is visible, and call buildExportContext
// directly with an explicit `today` — the whole point of that parameter.
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addDaysIso } from '../src/dates';
import { buildExportContext } from '../src/generator';
import type { MultiWeekProposalInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession, todayIso } from './fixtures';

function postJson(url: string, body?: unknown) {
	return SELF.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function putFeedback(sessionId: number, body: unknown) {
	return SELF.fetch(`https://training-app.test/api/sessions/${sessionId}/feedback`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

async function setDaysPerWeek(n: number) {
	await SELF.fetch('https://training-app.test/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ days_per_week: n }),
	});
}

/** Local multi-week seeder — deliberately separate from the other generator
 * test files' single-week seedOneSessionWeek/seedBaseline helpers (per the
 * brief, those aren't to be refactored). This file's whole point is seeding
 * MORE than one week, or a week that was never logged, to expose the
 * anchor/max divergence. One lift session per call, one planned set, logged
 * with 3 reps-at-top-at-low-RIR sets (a clean "weight increase earned" case)
 * when `logged` is true. */
async function seedLiftWeek(
	weekNumber: number,
	date: string,
	exerciseId: number,
	opts: { logged?: boolean; status?: 'planned' | 'completed' | 'skipped'; label?: string } = {},
): Promise<number> {
	const sessionId = await insertSession({ date, label: opts.label ?? `Week ${weekNumber}`, week_number: weekNumber, status: opts.status ?? 'planned' });
	await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
	if (opts.logged) {
		for (let i = 1; i <= 3; i++) {
			await insertLoggedSet(sessionId, exerciseId, { set_index: i, weight_kg: 20, reps: 10, rir: 1, performed_on: date });
		}
	}
	return sessionId;
}

/** The smallest positive multiple-of-7-days shift that lands strictly after
 * `today` — exactly the rule the fix is supposed to implement. Computed here
 * rather than hardcoded so the arithmetic isn't duplicated (and potentially
 * duplicated wrong) between the fix and the test asserting it. */
function smallestWeeklyShiftAfter(dateIso: string, today: string): number {
	let k = 1;
	while (addDaysIso(dateIso, 7 * k) <= today) k++;
	return k;
}

describe('buildExportContext — anchors on the last LOGGED week, not the last SCHEDULED one', () => {
	it('a 3-week accept leaves history/painFlags/skippedSessions/reasons reflecting the real logged week, not the newest unlogged one', async () => {
		const today = todayIso();
		const anchorDate = addDaysIso(today, -8); // over a week behind today
		const secondDate = addDaysIso(anchorDate, 1);

		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		const otherExerciseId = await insertExercise({ name: 'Bench', pattern: 'horizontal_push' });

		const loggedSessionId = await seedLiftWeek(1, anchorDate, exerciseId, { logged: true, label: 'Lift A' });
		// A second session the same week that was skipped outright — real
		// skippedSessions coverage, not the bug's permanent [].
		const skippedSessionId = await insertSession({ date: secondDate, label: 'Lift B', week_number: 1, status: 'skipped' });
		await insertPlannedSet(skippedSessionId, otherExerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 30, rest_seconds: 120 });

		await putFeedback(loggedSessionId, { back_pain_0_3: 0, shoulder_pain_0_3: 3, energy_1_5: 3, note: null });
		await setDaysPerWeek(2);

		// Accept a 3-week plan through the real route — weeks 2..4 land as
		// unlogged 'planned' sessions, exactly the setup the bug needs (mirrors
		// the accept test at generator.route.test.ts:96-137, one export further).
		const exportRes = await SELF.fetch('https://training-app.test/api/generator/export?weeks=3');
		expect(exportRes.status).toBe(200);
		const exportBody = (await exportRes.json()) as { deterministicProposal: MultiWeekProposalInput };
		const importRes = await postJson('https://training-app.test/api/generator/import', exportBody.deterministicProposal);
		expect(importRes.status).toBe(200);
		const { id } = (await importRes.json()) as { id: number };
		const acceptRes = await postJson(`https://training-app.test/api/generator/${id}/accept`);
		expect(acceptRes.status).toBe(200);

		// MAX(week_number) is now 4 (the newest of the unlogged weeks 2-4) — the
		// old bug anchored there. One more export call, straight at
		// buildExportContext, demonstrates it should still anchor on week 1.
		const context = await buildExportContext(env.DB, 1, today);

		expect(context.historyWindow.loggedSets.length).toBeGreaterThan(0);
		expect(context.historyWindow.loggedSets.some((s) => s.exercise_id === exerciseId)).toBe(true);
		expect(context.painFlags.shoulder).toBe(true);
		expect(context.skippedSessions).toHaveLength(1);
		expect(context.skippedSessions[0].label).toBe('Lift B');
		expect(context.skippedSessions[0].id).toBe(skippedSessionId);

		// -8 days needs a *second* +7 shift to actually clear today (-8+7 = -1,
		// still behind it) — computed via the same helper the rest of this file
		// uses, rather than assuming a single +7 suffices.
		const k = smallestWeeklyShiftAfter(anchorDate, today);
		const proposedDate = addDaysIso(anchorDate, 7 * k);
		const reason = context.reasons[`${proposedDate}:${exerciseId}`];
		expect(reason).toBeDefined();
		expect(reason).toMatch(/weight increase earned/);
		expect(reason).not.toMatch(/No sets logged/);
	});

	it('a logged week followed by several scheduled-but-unlogged weeks anchors on the logged one, not the newest scheduled one', async () => {
		const today = '2026-08-04';
		const week1Date = '2026-07-06';
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });

		await seedLiftWeek(1, week1Date, exerciseId, { logged: true });
		await seedLiftWeek(2, '2026-07-13', exerciseId); // scheduled, never logged
		await seedLiftWeek(3, '2026-07-20', exerciseId);
		await seedLiftWeek(4, '2026-07-27', exerciseId);

		const context = await buildExportContext(env.DB, 1, today);

		// Numbering still continues from maxWeekNumber (4), not the anchor (1).
		expect(context.deterministicProposal.weeks[0].week_number).toBe(5);

		expect(context.historyWindow.loggedSets.some((s) => s.exercise_id === exerciseId)).toBe(true);

		const k = smallestWeeklyShiftAfter(week1Date, today);
		const expectedDate = addDaysIso(week1Date, 7 * k);
		const proposedSession = context.deterministicProposal.weeks[0].sessions[0];
		expect(proposedSession.date).toBe(expectedDate);

		const reason = context.reasons[`${expectedDate}:${exerciseId}`];
		expect(reason).toMatch(/weight increase earned/);
	});

	it('numbers the proposal from maxWeekNumber + 1 even when the anchor is far behind it', async () => {
		const today = '2026-08-04';
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });

		await seedLiftWeek(1, '2026-06-01', exerciseId, { logged: true });
		await seedLiftWeek(7, '2026-07-27', exerciseId); // distant scheduled week, never logged

		const context = await buildExportContext(env.DB, 2, today);

		expect(context.deterministicProposal.weeks.map((w) => w.week_number)).toEqual([8, 9]);
	});

	it('sessions exist but nothing has ever been logged: empty weeks numbered from maxWeekNumber + 1, empty history, no pain flags', async () => {
		const today = '2026-08-04';
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		await seedLiftWeek(1, '2026-07-06', exerciseId); // planned, never logged
		await seedLiftWeek(2, '2026-07-13', exerciseId); // planned, never logged

		const context = await buildExportContext(env.DB, 3, today);

		expect(context.deterministicProposal).toEqual({
			weeks: [
				{ week_number: 3, sessions: [] },
				{ week_number: 4, sessions: [] },
				{ week_number: 5, sessions: [] },
			],
		});
		expect(context.historyWindow).toEqual({ loggedSets: [], loggedRuns: [] });
		expect(context.painFlags).toEqual({ shoulder: false, back: false });
		expect(context.skippedSessions).toEqual([]);
	});

	it('cold start (no sessions at all) is unchanged: weeks numbered 1..N', async () => {
		const context = await buildExportContext(env.DB, 3, '2026-08-04');

		expect(context.deterministicProposal).toEqual({
			weeks: [
				{ week_number: 1, sessions: [] },
				{ week_number: 2, sessions: [] },
				{ week_number: 3, sessions: [] },
			],
		});
		expect(context.historyWindow).toEqual({ loggedSets: [], loggedRuns: [] });
		expect(context.painFlags).toEqual({ shoulder: false, back: false });
	});

	it('shifts the anchor week forward by whichever multiple of 7 days is needed to clear today, preserving the weekday pattern', async () => {
		const today = '2026-08-04';
		const anchorDate = '2026-06-01'; // well over 7 days behind today — proves k > 1 is exercised
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		await seedLiftWeek(1, anchorDate, exerciseId, { logged: true });

		const k = smallestWeeklyShiftAfter(anchorDate, today);
		expect(k).toBeGreaterThan(1); // sanity check on the fixture itself

		const context = await buildExportContext(env.DB, 1, today);
		const proposedDate = context.deterministicProposal.weeks[0].sessions[0].date;

		expect(proposedDate).toBe(addDaysIso(anchorDate, 7 * k));
		expect(proposedDate > today).toBe(true);
		expect(new Date(`${proposedDate}T00:00:00Z`).getUTCDay()).toBe(new Date(`${anchorDate}T00:00:00Z`).getUTCDay());
	});

	it('a partly-elapsed anchor week (some sessions logged, some not yet) still anchors there, with the unlogged exercise holding', async () => {
		const today = '2026-08-04';
		const loggedDate = '2026-07-29';
		const unloggedDate = '2026-07-31';
		const loggedExerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		const unloggedExerciseId = await insertExercise({ name: 'Bench', pattern: 'horizontal_push', increment_kg: 2 });

		await seedLiftWeek(1, loggedDate, loggedExerciseId, { logged: true, label: 'Mon' });
		const unloggedSessionId = await insertSession({ date: unloggedDate, label: 'Wed', week_number: 1 });
		await insertPlannedSet(unloggedSessionId, unloggedExerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 40, rest_seconds: 120 });

		const context = await buildExportContext(env.DB, 1, today);

		expect(context.deterministicProposal.weeks[0].week_number).toBe(2);
		const proposedLoggedDate = addDaysIso(loggedDate, 7);
		const proposedUnloggedDate = addDaysIso(unloggedDate, 7);
		expect(context.reasons[`${proposedLoggedDate}:${loggedExerciseId}`]).toMatch(/weight increase earned/);
		expect(context.reasons[`${proposedUnloggedDate}:${unloggedExerciseId}`]).toMatch(/No sets logged/);
	});
});
