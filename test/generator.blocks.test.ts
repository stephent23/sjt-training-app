// Plan blocks: an accepted plan is one block, its weeks are numbered 1..N, and
// "start a new plan from date X" is the export's startDate. Week numbers
// restart per block, so the generator may never use them to decide what is
// newest — the anchor tests below seed week numbers that go backwards on
// purpose.
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addDaysIso, weekStartOnOrAfter } from '../src/dates';
import { buildExportContext } from '../src/generator';
import type { MultiWeekProposalInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession, todayIso } from './fixtures';

const BASE = 'https://training-app.test/api/generator';

function postJson(url: string, body?: unknown) {
	return SELF.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

async function setSettings(patch: Record<string, unknown>) {
	await SELF.fetch('https://training-app.test/api/settings', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(patch),
	});
}

/** One logged lift session yesterday — enough history for a real week 1. */
async function seedLoggedWeek(weekNumber = 1, date = addDaysIso(todayIso(), -1)) {
	const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
	const sessionId = await insertSession({ date, label: 'Lift A', week_number: weekNumber });
	await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
	await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: date });
	await setSettings({ days_per_week: 1 });
	return { exerciseId, sessionId, date };
}

async function exportPlan(query: string) {
	const res = await SELF.fetch(`${BASE}/export?${query}`);
	return { res, body: (await res.json()) as { deterministicProposal: MultiWeekProposalInput; weekStartDate: string; error?: string } };
}

async function importAndAccept(plan: MultiWeekProposalInput) {
	const imp = await postJson(`${BASE}/import`, plan);
	expect(imp.status).toBe(200);
	const { id } = (await imp.json()) as { id: number };
	const acc = await postJson(`${BASE}/${id}/accept`);
	expect(acc.status).toBe(200);
	return id;
}

describe('GET /export startDate', () => {
	it('rejects a startDate that is not a Monday', async () => {
		const notMonday = addDaysIso(weekStartOnOrAfter(addDaysIso(todayIso(), 7)), 2);
		const { res, body } = await exportPlan(`weeks=2&startDate=${notMonday}`);
		expect(res.status).toBe(400);
		expect(body.error).toMatch(/Monday/);
	});

	it('rejects a Monday in the past', async () => {
		const pastMonday = addDaysIso(weekStartOnOrAfter(todayIso()), -14);
		const { res, body } = await exportPlan(`weeks=2&startDate=${pastMonday}`);
		expect(res.status).toBe(400);
		expect(body.error).toMatch(/today or later/);
	});

	it('rejects garbage', async () => {
		expect((await exportPlan('startDate=tomorrow')).res.status).toBe(400);
	});

	it('defaults to the next Monday on or after today', async () => {
		const { res, body } = await exportPlan('weeks=1');
		expect(res.status).toBe(200);
		expect(body.weekStartDate).toBe(weekStartOnOrAfter(todayIso()));
	});

	it('lands week 1 on the chosen Monday and numbers the weeks 1..N, whatever the old numbering was', async () => {
		await seedLoggedWeek(23);
		const start = addDaysIso(weekStartOnOrAfter(todayIso()), 14);
		const { res, body } = await exportPlan(`weeks=3&startDate=${start}`);
		expect(res.status).toBe(200);
		expect(body.weekStartDate).toBe(start);

		const weeks = body.deterministicProposal.weeks;
		expect(weeks.map((w) => w.week_number)).toEqual([1, 2, 3]);
		// The anchor session was a single day; every proposed week is the week
		// starting on `start`, `start`+7, `start`+14.
		weeks.forEach((w, i) => {
			const first = addDaysIso(start, 7 * i);
			const last = addDaysIso(first, 6);
			expect(w.sessions[0].date >= first && w.sessions[0].date <= last).toBe(true);
		});
	});

	it('carries the 12-week training summary, including the logged lift', async () => {
		const { exerciseId } = await seedLoggedWeek(1);
		const res = await SELF.fetch(`${BASE}/export?weeks=1`);
		const body = (await res.json()) as { trainingSummary: { weeks: { lifting: { exercises: { exercise_id: number }[] } }[] } };
		expect(body.trainingSummary.weeks).toHaveLength(13);
		const lifted = body.trainingSummary.weeks.flatMap((w) => w.lifting.exercises.map((e) => e.exercise_id));
		expect(lifted).toContain(exerciseId);
	});

	it('a cold-start export is numbered 1..N and echoes the chosen start date', async () => {
		const start = addDaysIso(weekStartOnOrAfter(todayIso()), 7);
		const { body } = await exportPlan(`weeks=2&startDate=${start}`);
		expect(body.deterministicProposal.weeks.map((w) => w.week_number)).toEqual([1, 2]);
		expect(body.weekStartDate).toBe(start);
	});
});

describe('accepting a plan creates a block', () => {
	it('writes a plan_blocks row, tags the sessions with it and numbers weeks 1..N', async () => {
		await seedLoggedWeek(23);
		await setSettings({ goals: 'Half marathon in spring', goal_tags: ['build_strength'] });
		const start = weekStartOnOrAfter(addDaysIso(todayIso(), 1));
		const { body } = await exportPlan(`weeks=2&startDate=${start}`);
		const planId = await importAndAccept(body.deterministicProposal);

		const block = await env.DB.prepare(`SELECT * FROM plan_blocks`).first<{
			id: number;
			name: string;
			start_date: string;
			week_count: number;
			goals: string;
			goal_tags: string;
			generated_plan_id: number;
		}>();
		expect(block).toMatchObject({ name: 'Block 1', start_date: start, week_count: 2, goals: 'Half marathon in spring', generated_plan_id: planId });

		const { results } = await env.DB.prepare(`SELECT week_number, block_id FROM sessions WHERE block_id IS NOT NULL ORDER BY date`).all<{
			week_number: number;
			block_id: number;
		}>();
		expect(results.map((r) => r.week_number)).toEqual([1, 2]);
		expect(results.every((r) => r.block_id === block!.id)).toBe(true);
	});

	it('names the next block by count', async () => {
		await seedLoggedWeek(1);
		const start = weekStartOnOrAfter(addDaysIso(todayIso(), 1));
		await importAndAccept((await exportPlan(`weeks=1&startDate=${start}`)).body.deterministicProposal);
		await importAndAccept((await exportPlan(`weeks=1&startDate=${addDaysIso(start, 14)}`)).body.deterministicProposal);

		const { results } = await env.DB.prepare(`SELECT name FROM plan_blocks ORDER BY id`).all<{ name: string }>();
		expect(results.map((r) => r.name)).toEqual(['Block 1', 'Block 2']);
	});

	it('exposes the block on the sessions list', async () => {
		await seedLoggedWeek(1);
		const start = weekStartOnOrAfter(addDaysIso(todayIso(), 1));
		await importAndAccept((await exportPlan(`weeks=3&startDate=${start}`)).body.deterministicProposal);

		const res = await SELF.fetch(`https://training-app.test/api/sessions?from=${start}`);
		const { sessions } = (await res.json()) as { sessions: { block_name: string | null; block_week_count: number | null; week_number: number }[] };
		expect(sessions.length).toBeGreaterThan(0);
		expect(sessions[0]).toMatchObject({ block_name: 'Block 1', block_week_count: 3, week_number: 1 });
	});

	it('leaves a session with no block as null on the list', async () => {
		await insertSession({ date: '2026-08-03' });
		const res = await SELF.fetch('https://training-app.test/api/sessions');
		const { sessions } = (await res.json()) as { sessions: { block_name: string | null; block_id: number | null }[] };
		expect(sessions[0].block_name).toBeNull();
		expect(sessions[0].block_id).toBeNull();
	});
});

describe('the export anchor is date-based, not week_number-based', () => {
	it('anchors on the newest logged session even though a newer block restarted its week numbers', async () => {
		const today = todayIso();
		const exerciseA = await insertExercise({ name: 'Old block lift', pattern: 'squat' });
		const exerciseB = await insertExercise({ name: 'New block lift', pattern: 'horizontal_push' });
		// Block 1 ran up to week 12 and was logged long ago...
		const oldDate = addDaysIso(weekStartOnOrAfter(today), -35);
		const oldId = await insertSession({ date: oldDate, label: 'Old', week_number: 12 });
		await insertPlannedSet(oldId, exerciseA, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(oldId, exerciseA, { set_index: 1, weight_kg: 20, reps: 10, rir: 1, performed_on: oldDate });
		// ...block 2 restarted at week 1 and is what was trained last.
		const newDate = addDaysIso(today, -1);
		const newId = await insertSession({ date: newDate, label: 'New', week_number: 1 });
		await insertPlannedSet(newId, exerciseB, { order_index: 1, target_weight_kg: 30 });
		await insertLoggedSet(newId, exerciseB, { set_index: 1, weight_kg: 30, reps: 10, rir: 1, performed_on: newDate });

		const context = await buildExportContext(env.DB, 1, today);
		const sessions = context.deterministicProposal.weeks[0].sessions;
		expect(sessions.map((s) => s.label)).toEqual(['New']);
		expect(context.deterministicProposal.weeks[0].week_number).toBe(1);
	});

	it('ignores a manual run when choosing the anchor week', async () => {
		const today = todayIso();
		const exerciseId = await insertExercise();
		const date = addDaysIso(today, -9);
		const id = await insertSession({ date, label: 'Lift A', week_number: 1 });
		await insertPlannedSet(id, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(id, exerciseId, { set_index: 1, weight_kg: 20, reps: 10, rir: 1, performed_on: date });
		const manualDate = addDaysIso(today, -1);
		const manual = await insertSession({ date: manualDate, kind: 'run', label: 'Run', week_number: 1, origin: 'manual' });
		await env.DB.prepare(`INSERT INTO logged_runs (session_id, distance_km, duration_seconds, performed_on) VALUES (?, 5, 1800, ?)`)
			.bind(manual, manualDate)
			.run();

		const context = await buildExportContext(env.DB, 1, today);
		expect(context.deterministicProposal.weeks[0].sessions.map((s) => s.label)).toEqual(['Lift A']);
	});
});

describe('GET /pending review extras', () => {
	it('returns the mechanical proposal and how many untouched sessions accepting would replace', async () => {
		await seedLoggedWeek(1);
		const start = weekStartOnOrAfter(addDaysIso(todayIso(), 1));
		const { body } = await exportPlan(`weeks=1&startDate=${start}`);
		// An untouched planned session on a day the plan is about to cover.
		await insertSession({ date: body.deterministicProposal.weeks[0].sessions[0].date, label: 'Old plan', week_number: 1 });
		const imp = await postJson(`${BASE}/import`, body.deterministicProposal);
		expect(imp.status).toBe(200);

		const pending = (await (await SELF.fetch(`${BASE}/pending`)).json()) as {
			pending: { deterministic: MultiWeekProposalInput; replaces: number; start_date: string };
		};
		expect(pending.pending.replaces).toBe(1);
		expect(pending.pending.start_date).toBe(start);
		expect(pending.pending.deterministic.weeks).toHaveLength(1);
	});

	it('records source=live-api when the import asks for it', async () => {
		await seedLoggedWeek(1);
		const { body } = await exportPlan('weeks=1');
		await postJson(`${BASE}/import?source=live-api`, body.deterministicProposal);
		const row = await env.DB.prepare(`SELECT source FROM generated_plans`).first<{ source: string }>();
		expect(row?.source).toBe('live-api');
	});
});
