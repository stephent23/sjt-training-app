import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { MultiWeekProposalInput, ProposedSessionInput } from '../src/types';
import { insertExercise, insertLoggedRun, insertLoggedSet, insertPlannedRun, insertPlannedSet, insertSession } from './fixtures';

function postJson(url: string, body?: unknown) {
	return SELF.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function setDaysPerWeek(n: number) {
	await env.DB.prepare(`UPDATE settings SET days_per_week = ? WHERE id = 1`).bind(n).run();
}

function liftSession(date: string, label: string, exerciseId: number): ProposedSessionInput {
	return {
		date,
		kind: 'lift',
		label,
		plannedSets: [
			{
				exercise_id: exerciseId,
				order_index: 1,
				target_sets: 3,
				rep_low: 8,
				rep_high: 10,
				target_weight_kg: 20,
				rest_seconds: 120,
				notes: null,
				superset_group: null,
			},
		],
		plannedRun: null,
	};
}

/** A re-plan of an already-scheduled week: same dates the plan already owns,
 * which is exactly the case import used to refuse outright. */
function proposal(sessions: ProposedSessionInput[], weekNumber = 2): MultiWeekProposalInput {
	return { weeks: [{ week_number: weekNumber, sessions }] };
}

async function importProposalViaRoute(input: MultiWeekProposalInput, qs = '') {
	const res = await postJson(`https://training-app.test/api/generator/import${qs}`, input);
	const body = (await res.json()) as { id?: number; error?: string; errors?: string[] };
	return { res, body };
}

function acceptPlan(id: number | undefined) {
	return postJson(`https://training-app.test/api/generator/${id}/accept`);
}

async function listSessions(from: string, to: string) {
	const res = await SELF.fetch(`https://training-app.test/api/sessions?from=${from}&to=${to}&order=asc&limit=200`);
	const body = (await res.json()) as { sessions: { id: number; date: string; label: string; week_number: number }[] };
	return body.sessions;
}

async function countWhere(table: string, where: string, ...binds: unknown[]) {
	const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`)
		.bind(...binds)
		.first<{ n: number }>();
	return row!.n;
}

/** Nothing in the schema has ON DELETE CASCADE, so a session delete that
 * forgets a child table leaves rows pointing at an id that no longer exists —
 * invisible until some later join resurrects them against a recycled id. */
async function orphanCounts() {
	const tables = ['planned_sets', 'planned_runs', 'logged_sets', 'logged_runs', 'session_feedback', 'exercise_swaps'];
	const entries = await Promise.all(
		tables.map(async (table) => [table, await countWhere(table, `session_id NOT IN (SELECT id FROM sessions)`)] as const),
	);
	return Object.fromEntries(entries) as Record<string, number>;
}

const NO_ORPHANS = {
	planned_sets: 0,
	planned_runs: 0,
	logged_sets: 0,
	logged_runs: 0,
	session_feedback: 0,
	exercise_swaps: 0,
};

// Re-planning a week that is already on the calendar was impossible: import
// refused any proposed date that already had a session, and accept was a pure
// INSERT. Regenerating when circumstances change is the whole point of the
// generator, so the plan's own date span is now replaced wholesale — but only
// where nothing has actually been trained yet.
describe('import/accept replaces the sessions inside the proposal date span', () => {
	it('replaces an untouched planned session on a proposed date instead of refusing the import', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat' });
		const oldId = await insertSession({ date: '2026-08-10', label: 'Old Lift', week_number: 2 });
		await insertPlannedSet(oldId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await setDaysPerWeek(1);

		const { res, body } = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'New Lift', exerciseId)]));
		expect(body).toEqual({ id: expect.any(Number) });
		expect(res.status).toBe(200);

		const acceptRes = await postJson(`https://training-app.test/api/generator/${body.id}/accept`);
		expect(acceptRes.status).toBe(200);

		const sessions = await listSessions('2026-08-10', '2026-08-10');
		expect(sessions).toHaveLength(1);
		expect(sessions[0].label).toBe('New Lift');
		expect(sessions[0].id).not.toBe(oldId);
		expect(await countWhere('sessions', 'id = ?', oldId)).toBe(0);
	});

	// The span is calendar dates. A session's week_number is bookkeeping the
	// assistant is free to renumber, so keying replacement on it would leave
	// the real duplicate sitting on the day.
	it('replaces on date even when the existing session carries an unrelated week_number', async () => {
		const exerciseId = await insertExercise();
		const oldId = await insertSession({ date: '2026-08-10', label: 'Old Lift', week_number: 7 });
		await setDaysPerWeek(1);

		const { body } = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'New Lift', exerciseId)], 2));
		expect(await postJson(`https://training-app.test/api/generator/${body.id}/accept`)).toHaveProperty('status', 200);

		const sessions = await listSessions('2026-08-10', '2026-08-10');
		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).not.toBe(oldId);
		expect(sessions[0].week_number).toBe(2);
	});

	it('leaves sessions dated before and after the span alone, however they are numbered', async () => {
		const exerciseId = await insertExercise();
		// Same week_number as the incoming plan, deliberately — only the dates
		// decide what gets replaced.
		const beforeId = await insertSession({ date: '2026-08-03', label: 'Before', week_number: 2 });
		const insideId = await insertSession({ date: '2026-08-10', label: 'Inside', week_number: 2 });
		const afterId = await insertSession({ date: '2026-08-20', label: 'After', week_number: 2 });
		await setDaysPerWeek(2);

		const { body } = await importProposalViaRoute(
			proposal([liftSession('2026-08-10', 'New A', exerciseId), liftSession('2026-08-12', 'New B', exerciseId)]),
		);
		expect(body).toEqual({ id: expect.any(Number) });
		expect(await postJson(`https://training-app.test/api/generator/${body.id}/accept`)).toHaveProperty('status', 200);

		expect(await countWhere('sessions', 'id = ?', beforeId)).toBe(1);
		expect(await countWhere('sessions', 'id = ?', afterId)).toBe(1);
		expect(await countWhere('sessions', 'id = ?', insideId)).toBe(0);

		const sessions = await listSessions('2026-08-01', '2026-08-31');
		expect(sessions.map((s) => s.label)).toEqual(['Before', 'New A', 'New B', 'After']);
	});

	// A lighter new week must not leave yesterday's plan showing on a day it no
	// longer trains — the span is replaced wholesale, not merged date by date.
	it('clears an untouched session on a day inside the span that the new plan skips', async () => {
		const exerciseId = await insertExercise();
		await insertSession({ date: '2026-08-10', label: 'Mon', week_number: 2 });
		const strayId = await insertSession({ date: '2026-08-11', label: 'Tue', week_number: 2 });
		await insertSession({ date: '2026-08-12', label: 'Wed', week_number: 2 });
		await setDaysPerWeek(2);

		const { body } = await importProposalViaRoute(
			proposal([liftSession('2026-08-10', 'New Mon', exerciseId), liftSession('2026-08-12', 'New Wed', exerciseId)]),
		);
		expect(body).toEqual({ id: expect.any(Number) });
		expect(await postJson(`https://training-app.test/api/generator/${body.id}/accept`)).toHaveProperty('status', 200);

		expect(await countWhere('sessions', 'id = ?', strayId)).toBe(0);
		const sessions = await listSessions('2026-08-01', '2026-08-31');
		expect(sessions.map((s) => s.date)).toEqual(['2026-08-10', '2026-08-12']);
	});

	// The span runs across the whole proposal, not week by week, so the gap
	// between two proposed weeks is cleared too.
	it('spans from the proposal first date to its last across every week', async () => {
		const exerciseId = await insertExercise();
		await insertSession({ date: '2026-08-10', label: 'Week 2', week_number: 2 });
		const gapId = await insertSession({ date: '2026-08-13', label: 'Between the weeks', week_number: 2 });
		await insertSession({ date: '2026-08-17', label: 'Week 3', week_number: 2 });
		await setDaysPerWeek(1);

		const { body } = await importProposalViaRoute({
			weeks: [
				{ week_number: 2, sessions: [liftSession('2026-08-10', 'New week 2', exerciseId)] },
				{ week_number: 3, sessions: [liftSession('2026-08-17', 'New week 3', exerciseId)] },
			],
		});
		expect(body).toEqual({ id: expect.any(Number) });
		expect(await postJson(`https://training-app.test/api/generator/${body.id}/accept`)).toHaveProperty('status', 200);

		expect(await countWhere('sessions', 'id = ?', gapId)).toBe(0);
		const sessions = await listSessions('2026-08-01', '2026-08-31');
		expect(sessions.map((s) => s.label)).toEqual(['New week 2', 'New week 3']);
	});

	it('takes every child row with a replaced session — nothing has ON DELETE CASCADE', async () => {
		const fromExercise = await insertExercise({ name: 'Bench press' });
		const toExercise = await insertExercise({ name: 'Dumbbell press' });
		const liftId = await insertSession({ date: '2026-08-10', label: 'Old Lift', week_number: 2 });
		await insertPlannedSet(liftId, fromExercise, { order_index: 1 });
		await env.DB.prepare(`INSERT INTO exercise_swaps (session_id, from_exercise_id, to_exercise_id, reason, scope) VALUES (?, ?, ?, 'preference', 'this_session')`)
			.bind(liftId, fromExercise, toExercise)
			.run();
		await env.DB.prepare(`INSERT INTO session_feedback (session_id, back_pain_0_3, shoulder_pain_0_3, energy_1_5, note) VALUES (?, 0, 0, 3, 'fine')`)
			.bind(liftId)
			.run();

		const runId = await insertSession({ date: '2026-08-11', kind: 'run', label: 'Old Run', week_number: 2 });
		await insertPlannedRun(runId, { run_type: 'easy', target_minutes: 30 });
		await setDaysPerWeek(2);

		const { body } = await importProposalViaRoute(
			proposal([liftSession('2026-08-10', 'New Lift', fromExercise), liftSession('2026-08-11', 'New Lift B', toExercise)]),
		);
		expect(body).toEqual({ id: expect.any(Number) });
		expect(await postJson(`https://training-app.test/api/generator/${body.id}/accept`)).toHaveProperty('status', 200);

		expect(await countWhere('planned_sets', 'session_id = ?', liftId)).toBe(0);
		expect(await countWhere('exercise_swaps', 'session_id = ?', liftId)).toBe(0);
		expect(await countWhere('session_feedback', 'session_id = ?', liftId)).toBe(0);
		expect(await countWhere('planned_runs', 'session_id = ?', runId)).toBe(0);
		expect(await orphanCounts()).toEqual(NO_ORPHANS);
	});
});

describe('import refuses to overwrite training that has already happened', () => {
	it('refuses when a session in the span is completed', async () => {
		const exerciseId = await insertExercise();
		await insertSession({ date: '2026-08-10', label: 'Done', status: 'completed', week_number: 2 });
		await setDaysPerWeek(1);

		const { res, body } = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'New Lift', exerciseId)]));
		expect(res.status).toBe(422);
		expect(body.errors).toEqual([`2026-08-10 already has training you've done — the plan can't overwrite it`]);
		expect(body.error).toBe(`2026-08-10 already has training you've done — the plan can't overwrite it`);
	});

	// A skipped day is a decision you made, not an empty slot — overwriting it
	// would erase the record that you chose not to train.
	it('refuses when a session in the span is skipped', async () => {
		const exerciseId = await insertExercise();
		await insertSession({ date: '2026-08-10', label: 'Skipped', status: 'skipped', week_number: 2 });
		await setDaysPerWeek(1);

		const { res, body } = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'New Lift', exerciseId)]));
		expect(res.status).toBe(422);
		expect(body.errors).toEqual([`2026-08-10 already has training you've done — the plan can't overwrite it`]);
	});

	// Status alone isn't enough: logging sets against a session doesn't move it
	// off 'planned' until it is explicitly completed, so a half-finished
	// session still reads as untouched by status.
	it('refuses when a still-planned session in the span carries a logged set', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession({ date: '2026-08-10', label: 'Half done', week_number: 2 });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1 });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 1, performed_on: '2026-08-10' });
		await setDaysPerWeek(1);

		const { res, body } = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'New Lift', exerciseId)]));
		expect(res.status).toBe(422);
		expect(body.errors).toEqual([`2026-08-10 already has training you've done — the plan can't overwrite it`]);
	});

	it('refuses when a still-planned session in the span carries a logged run', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession({ date: '2026-08-10', kind: 'run', label: 'Ran it anyway', week_number: 2 });
		await insertPlannedRun(sessionId, { run_type: 'easy', target_minutes: 30 });
		await insertLoggedRun(sessionId, { performed_on: '2026-08-10' });
		await setDaysPerWeek(1);

		const { res, body } = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'New Lift', exerciseId)]));
		expect(res.status).toBe(422);
		expect(body.errors).toEqual([`2026-08-10 already has training you've done — the plan can't overwrite it`]);
	});

	it('lists every offending date and deletes nothing at all', async () => {
		const exerciseId = await insertExercise();
		const doneId = await insertSession({ date: '2026-08-10', label: 'Done', status: 'completed', week_number: 2 });
		await insertPlannedSet(doneId, exerciseId, { order_index: 1 });
		const untouchedId = await insertSession({ date: '2026-08-11', label: 'Untouched', week_number: 2 });
		await insertPlannedSet(untouchedId, exerciseId, { order_index: 1 });
		const loggedId = await insertSession({ date: '2026-08-12', label: 'Logged', week_number: 2 });
		await insertPlannedSet(loggedId, exerciseId, { order_index: 1 });
		await insertLoggedSet(loggedId, exerciseId, { set_index: 1, performed_on: '2026-08-12' });
		await setDaysPerWeek(2);

		const { res, body } = await importProposalViaRoute(
			proposal([liftSession('2026-08-10', 'New A', exerciseId), liftSession('2026-08-12', 'New B', exerciseId)]),
		);
		expect(res.status).toBe(422);
		expect(body.errors).toEqual([
			`2026-08-10 already has training you've done — the plan can't overwrite it`,
			`2026-08-12 already has training you've done — the plan can't overwrite it`,
		]);

		// A refusal is all-or-nothing: the untouched day inside the span must
		// not have been cleared on the way to discovering the refusal.
		const sessions = await listSessions('2026-08-01', '2026-08-31');
		expect(sessions.map((s) => s.id)).toEqual([doneId, untouchedId, loggedId]);
		expect(await countWhere('planned_sets', 'session_id IN (?, ?, ?)', doneId, untouchedId, loggedId)).toBe(3);
		expect(await countWhere('logged_sets', 'session_id = ?', loggedId)).toBe(1);
		expect(await countWhere('generated_plans', `status = 'pending'`)).toBe(0);
	});
});

// Reviewing a plan and accepting it are separate steps with a human-sized gap
// between them — long enough to go and train one of the days the plan is about
// to overwrite. Checking only at import time would delete that session.
describe('accept re-checks the span', () => {
	it('409s and deletes nothing when a set is logged in the span between import and accept', async () => {
		const exerciseId = await insertExercise();
		const existingId = await insertSession({ date: '2026-08-10', label: 'Old Lift', week_number: 2 });
		await insertPlannedSet(existingId, exerciseId, { order_index: 1 });
		await setDaysPerWeek(1);

		const { res, body } = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'New Lift', exerciseId)]));
		expect(res.status).toBe(200);

		await insertLoggedSet(existingId, exerciseId, { set_index: 1, performed_on: '2026-08-10' });

		const acceptRes = await postJson(`https://training-app.test/api/generator/${body.id}/accept`);
		expect(acceptRes.status).toBe(409);
		const acceptBody = (await acceptRes.json()) as { error: string; errors: string[] };
		expect(acceptBody.errors).toEqual([`2026-08-10 already has training you've done — the plan can't overwrite it`]);
		expect(acceptBody.error).toBe(`2026-08-10 already has training you've done — the plan can't overwrite it`);

		// The session that was trained survives, with its logged work, and the
		// plan's replacement session was not inserted alongside it.
		const sessions = await listSessions('2026-08-01', '2026-08-31');
		expect(sessions.map((s) => s.id)).toEqual([existingId]);
		expect(sessions[0].label).toBe('Old Lift');
		expect(await countWhere('logged_sets', 'session_id = ?', existingId)).toBe(1);
		expect(await countWhere('planned_sets', 'session_id = ?', existingId)).toBe(1);
	});
});

// `?replace=true` has always meant "supersede the pending proposal". The date
// span replacement is a different thing entirely, and is the default with no
// flag at all — conflating the two would make re-planning require a flag that
// means something else.
describe('?replace=true and date-span replacement are independent', () => {
	it('supersedes the pending proposal without touching the sessions it would overwrite', async () => {
		const exerciseId = await insertExercise();
		const existingId = await insertSession({ date: '2026-08-10', label: 'Old Lift', week_number: 2 });
		await insertPlannedSet(existingId, exerciseId, { order_index: 1 });
		await setDaysPerWeek(1);

		const first = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'Plan A', exerciseId)]));
		expect(first.res.status).toBe(200);

		const second = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'Plan B', exerciseId)]), '?replace=true');
		expect(second.res.status).toBe(200);
		expect(second.body.id).not.toBe(first.body.id);

		// Import writes no sessions, replace flag or not — the scheduled day is
		// still exactly as it was.
		const beforeAccept = await listSessions('2026-08-10', '2026-08-10');
		expect(beforeAccept.map((s) => s.id)).toEqual([existingId]);
		expect(beforeAccept[0].label).toBe('Old Lift');

		expect(await postJson(`https://training-app.test/api/generator/${second.body.id}/accept`)).toHaveProperty('status', 200);
		const afterAccept = await listSessions('2026-08-10', '2026-08-10');
		expect(afterAccept).toHaveLength(1);
		expect(afterAccept[0].label).toBe('Plan B');
	});

	it('replaces the scheduled span with no flag at all, while a second import still needs one', async () => {
		const exerciseId = await insertExercise();
		await insertSession({ date: '2026-08-10', label: 'Old Lift', week_number: 2 });
		await setDaysPerWeek(1);

		const first = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'Plan A', exerciseId)]));
		expect(first.res.status).toBe(200);

		// Clashing dates no longer refuse; a clashing *pending plan* still does.
		const second = await importProposalViaRoute(proposal([liftSession('2026-08-10', 'Plan B', exerciseId)]));
		expect(second.res.status).toBe(422);
		expect(second.body.errors).toEqual([expect.stringMatching(/already pending/)]);
	});
});
