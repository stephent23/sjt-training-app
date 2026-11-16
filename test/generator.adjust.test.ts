import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addDaysIso, daysBetweenIso, weekStartOnOrAfter, weekStartOnOrBefore } from '../src/dates';
import type { ActiveBlock, AdjustContext, MultiWeekProposalInput } from '../src/types';
import { insertExercise, insertLoggedRun, insertLoggedSet, insertPlannedRun, insertPlannedSet, insertSession, todayIso } from './fixtures';

// "Adjust current block" — these go through SELF.fetch, so the route reads the
// real clock. Nothing is pinned to literal dates: the block is laid out
// relative to today (it started two weeks before this week's Monday and runs
// six weeks), and the assertions are relationships.

const BASE = 'https://training-app.test/api/generator';
const WEEKS = 6;

function postJson(url: string, body?: unknown) {
	return SELF.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

interface Seeded {
	blockId: number;
	start: string;
	nextMonday: string;
	firstWeek: number;
	remaining: number;
	exerciseId: number;
	/** session id by block-week index (0-based): [lift, run] */
	sessions: { lift: number; run: number }[];
}

/** One block: Monday lift + Wednesday easy run in each of its six weeks. Week 0's
 * lift and run were trained; week 1's lift was skipped. */
async function seedBlock(): Promise<Seeded> {
	const today = todayIso();
	const start = addDaysIso(weekStartOnOrBefore(today), -14);
	const nextMonday = weekStartOnOrAfter(today);
	await env.DB.prepare(`UPDATE settings SET days_per_week = 2 WHERE id = 1`).run();
	const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
	const block = await env.DB.prepare(
		`INSERT INTO plan_blocks (name, start_date, week_count, goals, goal_tags) VALUES ('Block 2', ?, ?, 'run a PB half', '[]') RETURNING id`,
	)
		.bind(start, WEEKS)
		.first<{ id: number }>();

	const sessions: Seeded['sessions'] = [];
	for (let w = 0; w < WEEKS; w++) {
		const lift = await insertSession({ date: addDaysIso(start, w * 7), kind: 'lift', label: 'Lift A', week_number: w + 1 });
		const run = await insertSession({ date: addDaysIso(start, w * 7 + 2), kind: 'run', label: 'Easy run', week_number: w + 1 });
		await env.DB.prepare(`UPDATE sessions SET block_id = ? WHERE id IN (?, ?)`).bind(block!.id, lift, run).run();
		await insertPlannedSet(lift, exerciseId, { target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20 });
		await insertPlannedRun(run, { run_type: 'easy', target_km: 5, target_minutes: null });
		sessions.push({ lift, run });
	}
	// Week 0 trained.
	const d0 = addDaysIso(start, 0);
	for (const [i, reps] of [9, 8, 8].entries()) await insertLoggedSet(sessions[0].lift, exerciseId, { set_index: i + 1, weight_kg: 20, reps, rir: i === 0 ? 1 : 2, performed_on: d0 });
	await env.DB.prepare(`UPDATE sessions SET status = 'completed' WHERE id IN (?, ?)`).bind(sessions[0].lift, sessions[0].run).run();
	await insertLoggedRun(sessions[0].run, { distance_km: 5, duration_seconds: 1800, avg_hr: 140, rpe_1_10: 4, performed_on: addDaysIso(start, 2) });
	// Week 1: the lift was skipped.
	await env.DB.prepare(`UPDATE sessions SET status = 'skipped' WHERE id = ?`).bind(sessions[1].lift).run();

	const firstWeek = daysBetweenIso(start, nextMonday) / 7 + 1;
	return { blockId: block!.id, start, nextMonday, firstWeek, remaining: WEEKS - (firstWeek - 1), exerciseId, sessions };
}

async function exportAdjust(seed: Seeded, query = '') {
	const res = await SELF.fetch(`${BASE}/export?adjust=${seed.blockId}${query}`);
	return { res, body: (await res.json()) as { deterministicProposal: MultiWeekProposalInput; adjust: AdjustContext; races: { block_week: number | null }[] } };
}

async function importAdjust(seed: Seeded, proposal: MultiWeekProposalInput) {
	return postJson(`${BASE}/import?adjust=${seed.blockId}`, proposal);
}

async function scheduledDates(seed: Seeded): Promise<string[]> {
	const { results } = await env.DB.prepare(`SELECT date FROM sessions WHERE block_id = ? AND date >= ? ORDER BY date`).bind(seed.blockId, seed.nextMonday).all<{ date: string }>();
	return results.map((r) => r.date);
}

describe('GET /active-block', () => {
	it('is null with no blocks, and for a block that has ended', async () => {
		expect(await (await SELF.fetch(`${BASE}/active-block`)).json()).toEqual({ block: null });
		await env.DB.prepare(`INSERT INTO plan_blocks (name, start_date, week_count) VALUES ('Old', ?, 2)`).bind(addDaysIso(todayIso(), -60)).run();
		expect(await (await SELF.fetch(`${BASE}/active-block`)).json()).toEqual({ block: null });
	});

	it('describes the block in progress, with weeks_remaining and the coaching note', async () => {
		const seed = await seedBlock();
		const plan = await env.DB.prepare(
			`INSERT INTO generated_plans (status, first_week_number, week_count, plan_json, deterministic_json) VALUES ('accepted', 1, 6, ?, '{"weeks":[]}') RETURNING id`,
		)
			.bind(JSON.stringify({ weeks: [], summary: 'Six weeks to the half.' }))
			.first<{ id: number }>();
		await env.DB.prepare(`UPDATE plan_blocks SET generated_plan_id = ? WHERE id = ?`).bind(plan!.id, seed.blockId).run();

		const { block } = (await (await SELF.fetch(`${BASE}/active-block`)).json()) as { block: ActiveBlock };
		expect(block).toMatchObject({
			id: seed.blockId,
			name: 'Block 2',
			start_date: seed.start,
			week_count: WEEKS,
			current_week: daysBetweenIso(seed.start, weekStartOnOrBefore(todayIso())) / 7 + 1,
			next_monday: seed.nextMonday,
			weeks_remaining: seed.remaining,
			summary: 'Six weeks to the half.',
		});
	});

	it('reports 0 weeks remaining in the block\'s last week unless today is its Monday', async () => {
		const today = todayIso();
		const lastMonday = weekStartOnOrBefore(today);
		await env.DB.prepare(`INSERT INTO plan_blocks (name, start_date, week_count) VALUES ('Last week', ?, 3)`).bind(addDaysIso(lastMonday, -14)).run();
		const { block } = (await (await SELF.fetch(`${BASE}/active-block`)).json()) as { block: ActiveBlock };
		expect(block.current_week).toBe(3);
		expect(block.weeks_remaining).toBe(today === lastMonday ? 1 : 0);
	});
});

describe('GET /export?adjust=', () => {
	it('continues the block numbering, and the deterministic weeks are the scheduled sessions', async () => {
		const seed = await seedBlock();
		const { res, body } = await exportAdjust(seed, `&weeks=${seed.remaining}`);
		expect(res.status).toBe(200);

		const weeks = body.deterministicProposal.weeks;
		expect(weeks.map((w) => w.week_number)).toEqual(Array.from({ length: seed.remaining }, (_, i) => seed.firstWeek + i));
		expect(weeks.flatMap((w) => w.sessions.map((s) => s.date))).toEqual(await scheduledDates(seed));
		const lift = weeks[0].sessions[0];
		expect(lift).toMatchObject({ kind: 'lift', label: 'Lift A' });
		expect(lift.plannedSets[0]).toMatchObject({ exercise_id: seed.exerciseId, target_sets: 3, target_weight_kg: 20 });
		expect(weeks[0].sessions[1].plannedRun).toMatchObject({ run_type: 'easy', target_km: 5 });
		expect(body.adjust.firstWeekNumber).toBe(seed.firstWeek);
		expect(body.adjust.block).toMatchObject({ id: seed.blockId, name: 'Block 2', goals: 'run a PB half' });
	});

	it('shows planned against done for the weeks already past, including unplanned runs', async () => {
		const seed = await seedBlock();
		const manual = await insertSession({ date: addDaysIso(seed.start, 4), kind: 'run', label: 'Parkrun', status: 'completed', origin: 'manual' });
		await insertLoggedRun(manual, { distance_km: 5.2, duration_seconds: 3725, avg_hr: null, rpe_1_10: null, performed_on: addDaysIso(seed.start, 4) });

		const { body } = await exportAdjust(seed);
		const week1 = body.adjust.elapsed.find((w) => w.week_number === 1)!;
		expect(week1.sessions.map((s) => [s.kind, s.planned, s.done])).toEqual([
			['lift', 'Goblet squat 3x8-10 @20kg', 'Goblet squat 20kg x9/8/8 (RIR 1-2)'],
			['run', 'easy 5 km', '5 km in 30:00, RPE 4, avg HR 140'],
			['run', 'unplanned run', '5.2 km in 1:02:05'],
		]);
		const week2 = body.adjust.elapsed.find((w) => w.week_number === 2)!;
		expect(week2.sessions[0]).toMatchObject({ status: 'skipped', planned: 'Goblet squat 3x8-10 @20kg', done: null });
		// Elapsed is only what is before the start date; scheduled starts on it.
		expect(body.adjust.elapsed.flatMap((w) => w.sessions).every((s) => s.date < seed.nextMonday)).toBe(true);
		expect(body.adjust.scheduled.flatMap((w) => w.sessions.map((s) => s.date))).toEqual(await scheduledDates(seed));
		expect(body.adjust.scheduled.flatMap((w) => w.sessions).every((s) => s.done === null)).toBe(true);
	});

	it('extends the block by copying the last scheduled week forward 7 days', async () => {
		const seed = await seedBlock();
		const { body } = await exportAdjust(seed, `&weeks=${seed.remaining + 2}`);
		const weeks = body.deterministicProposal.weeks;
		expect(weeks).toHaveLength(seed.remaining + 2);
		const last = weeks[seed.remaining - 1];
		for (const extra of [1, 2]) {
			const copy = weeks[seed.remaining - 1 + extra];
			expect(copy.week_number).toBe(last.week_number + extra);
			expect(copy.sessions.map((s) => s.date)).toEqual(last.sessions.map((s) => addDaysIso(s.date, 7 * extra)));
			expect(copy.sessions[0].plannedSets[0]).toMatchObject({ target_weight_kg: 20 });
		}
	});

	it('rejects a bad start date or block, and 404s an unknown block', async () => {
		const seed = await seedBlock();
		const tuesday = addDaysIso(seed.nextMonday, 1);
		expect((await exportAdjust(seed, `&startDate=${tuesday}`)).res.status).toBe(400);
		expect((await exportAdjust(seed, `&startDate=${addDaysIso(seed.start, -7)}`)).res.status).toBe(400); // in the past
		expect((await exportAdjust(seed, `&startDate=${addDaysIso(seed.start, 7 * WEEKS + 7)}`)).res.status).toBe(400); // not adjacent to the block
		expect((await exportAdjust(seed, `&startDate=${addDaysIso(seed.start, 7 * WEEKS)}`)).res.status).toBe(200); // right after it

		const unknown = await SELF.fetch(`${BASE}/export?adjust=9999`);
		expect(unknown.status).toBe(404);
		expect(await unknown.json()).toHaveProperty('error');
		expect((await SELF.fetch(`${BASE}/export?adjust=abc`)).status).toBe(400);
	});
});

describe('import and accept with adjust', () => {
	it('stores the block on the pending plan and reports what accepting replaces', async () => {
		const seed = await seedBlock();
		const { body } = await exportAdjust(seed, `&weeks=${seed.remaining}`);
		const res = await importAdjust(seed, body.deterministicProposal);
		expect(res.status).toBe(200);

		const row = await env.DB.prepare(`SELECT block_id, first_week_number FROM generated_plans WHERE status = 'pending'`).first<{ block_id: number; first_week_number: number }>();
		expect(row).toEqual({ block_id: seed.blockId, first_week_number: seed.firstWeek });

		const { pending } = (await (await SELF.fetch(`${BASE}/pending`)).json()) as { pending: { block: unknown; replaces: number; start_date: string } };
		expect(pending.block).toEqual({ id: seed.blockId, name: 'Block 2', week_count: WEEKS });
		expect(pending.replaces).toBe((await scheduledDates(seed)).length);
		expect(pending.start_date).toBe(seed.nextMonday);
	});

	it('validates against the scheduled baseline and the continued numbering', async () => {
		const seed = await seedBlock();
		const { body } = await exportAdjust(seed, `&weeks=${seed.remaining}`);

		const jump = structuredClone(body.deterministicProposal);
		jump.weeks[0].sessions[0].plannedSets[0].target_weight_kg = 26; // +30% on 20kg
		const jumped = await importAdjust(seed, jump);
		expect(jumped.status).toBe(422);
		expect(((await jumped.json()) as { error: string }).error).toContain('Weight jump');

		const restarted = structuredClone(body.deterministicProposal);
		restarted.weeks.forEach((w, i) => (w.week_number = i + 1));
		const renumbered = await importAdjust(seed, restarted);
		expect(renumbered.status).toBe(422);
		expect(((await renumbered.json()) as { error: string }).error).toContain('week_number');
	});

	it('accepting keeps the block, continues the numbering and never touches trained sessions', async () => {
		const seed = await seedBlock();
		const { body } = await exportAdjust(seed, `&weeks=${seed.remaining}`);
		const proposal = structuredClone(body.deterministicProposal);
		proposal.weeks[0].sessions[0].plannedSets[0].target_weight_kg = 22;
		proposal.weeks[0].sessions[0].label = 'Lift A (revised)';
		const id = ((await (await importAdjust(seed, proposal)).json()) as { id: number }).id;

		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);

		expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM plan_blocks`).first<{ n: number }>())!.n).toBe(1);
		const block = await env.DB.prepare(`SELECT week_count FROM plan_blocks WHERE id = ?`).bind(seed.blockId).first<{ week_count: number }>();
		expect(block!.week_count).toBe(WEEKS);
		const { results } = await env.DB.prepare(`SELECT date, label, week_number, block_id FROM sessions WHERE date >= ? ORDER BY date`).bind(seed.nextMonday).all<{ date: string; label: string; week_number: number; block_id: number }>();
		expect(results.every((s) => s.block_id === seed.blockId)).toBe(true);
		expect(results.map((s) => s.week_number)).toEqual(proposal.weeks.flatMap((w) => w.sessions.map(() => w.week_number)));
		expect(results[0].label).toBe('Lift A (revised)');
		// Elapsed sessions, trained or not, are exactly as they were.
		const past = await env.DB.prepare(`SELECT id FROM sessions WHERE date < ?`).bind(seed.nextMonday).all<{ id: number }>();
		expect(past.results.map((r) => r.id)).toContain(seed.sessions[0].lift);
		expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM logged_sets WHERE session_id = ?`).bind(seed.sessions[0].lift).first<{ n: number }>())!.n).toBe(3);
	});

	it('a shorter plan deletes the untouched later sessions and shortens the block', async () => {
		const seed = await seedBlock();
		const { body } = await exportAdjust(seed, '&weeks=1');
		// A later session that was trained survives, and keeps its week in the block.
		const keepWeek = seed.firstWeek + 2; // block week number of the trained session
		const trained = seed.sessions[keepWeek - 1].lift;
		await insertLoggedSet(trained, seed.exerciseId, { performed_on: addDaysIso(seed.start, (keepWeek - 1) * 7) });
		const id = ((await (await importAdjust(seed, body.deterministicProposal)).json()) as { id: number }).id;

		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);

		const remaining = await scheduledDates(seed);
		const week1Dates = body.deterministicProposal.weeks[0].sessions.map((s) => s.date);
		const trainedDate = addDaysIso(seed.start, (keepWeek - 1) * 7);
		expect(remaining).toEqual([...week1Dates, trainedDate]);
		const block = await env.DB.prepare(`SELECT week_count FROM plan_blocks WHERE id = ?`).bind(seed.blockId).first<{ week_count: number }>();
		expect(block!.week_count).toBe(keepWeek);
	});

	it('a shorter plan with nothing trained later sets week_count to the plan\'s last week', async () => {
		const seed = await seedBlock();
		const { body } = await exportAdjust(seed, '&weeks=2');
		const id = ((await (await importAdjust(seed, body.deterministicProposal)).json()) as { id: number }).id;
		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);
		const block = await env.DB.prepare(`SELECT week_count FROM plan_blocks WHERE id = ?`).bind(seed.blockId).first<{ week_count: number }>();
		expect(block!.week_count).toBe(seed.firstWeek + 1);
		expect(await scheduledDates(seed)).toHaveLength(4);
	});

	it('an extended plan lengthens the block', async () => {
		const seed = await seedBlock();
		const { body } = await exportAdjust(seed, `&weeks=${seed.remaining + 2}`);
		const id = ((await (await importAdjust(seed, body.deterministicProposal)).json()) as { id: number }).id;
		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);
		const block = await env.DB.prepare(`SELECT week_count FROM plan_blocks WHERE id = ?`).bind(seed.blockId).first<{ week_count: number }>();
		expect(block!.week_count).toBe(WEEKS + 2);
		const { results } = await env.DB.prepare(`SELECT MAX(week_number) AS w FROM sessions WHERE block_id = ?`).bind(seed.blockId).all<{ w: number }>();
		expect(results[0].w).toBe(WEEKS + 2);
	});

	it('409s, changing nothing, when a session in the span was trained after import', async () => {
		const seed = await seedBlock();
		const { body } = await exportAdjust(seed, `&weeks=${seed.remaining}`);
		const id = ((await (await importAdjust(seed, body.deterministicProposal)).json()) as { id: number }).id;
		const firstScheduled = (await env.DB.prepare(`SELECT id, date FROM sessions WHERE block_id = ? AND date >= ? ORDER BY date LIMIT 1`).bind(seed.blockId, seed.nextMonday).first<{ id: number; date: string }>())!;
		await insertLoggedSet(firstScheduled.id, seed.exerciseId, { performed_on: firstScheduled.date });

		const res = await postJson(`${BASE}/${id}/accept`);
		expect(res.status).toBe(409);
		expect(((await res.json()) as { error: string }).error).toContain("already has training you've done");
		expect(await scheduledDates(seed)).toHaveLength(seed.remaining * 2);
	});

	it('a normal plan still creates a new block', async () => {
		const seed = await seedBlock();
		const exportRes = await SELF.fetch(`${BASE}/export?weeks=1`);
		const proposal = ((await exportRes.json()) as { deterministicProposal: MultiWeekProposalInput }).deterministicProposal;
		const id = ((await (await postJson(`${BASE}/import`, proposal)).json()) as { id: number }).id;
		const { pending } = (await (await SELF.fetch(`${BASE}/pending`)).json()) as { pending: { block: unknown } };
		expect(pending.block).toBeNull();

		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);
		expect((await env.DB.prepare(`SELECT COUNT(*) AS n FROM plan_blocks`).first<{ n: number }>())!.n).toBe(2);
		const fresh = await env.DB.prepare(`SELECT week_number, block_id FROM sessions WHERE block_id <> ? ORDER BY date LIMIT 1`).bind(seed.blockId).first<{ week_number: number; block_id: number }>();
		expect(fresh!.week_number).toBe(1);
	});
});
