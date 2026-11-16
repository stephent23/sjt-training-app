// Plan blocks never overlap in dates: accepting a new block supersedes every
// untouched planned session from its start on (in any block) and trims or
// removes the block that held them; migration 0014 repairs data that already
// overlaps.
import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { addDaysIso, weekStartOnOrAfter } from '../src/dates';
import type { MultiWeekProposalInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedRun, insertPlannedSet, insertSession, todayIso } from './fixtures';

const BASE = 'https://training-app.test/api/generator';

function postJson(url: string, body?: unknown) {
	return SELF.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
}

/** S: a Monday two weeks out, where the new block starts. */
const S = addDaysIso(weekStartOnOrAfter(todayIso()), 14);

async function seedHistory() {
	const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
	const date = addDaysIso(todayIso(), -1);
	const sessionId = await insertSession({ date, label: 'Lift A', week_number: 1 });
	await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
	await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: date });
	await env.DB.prepare(`UPDATE settings SET days_per_week = 2 WHERE id = 1`).run();
	return exerciseId;
}

/** A block starting at `start` with one Monday lift per week; week_count is
 * `weekCount` (default: the number of weeks). */
async function seedBlock(name: string, start: string, weeks: number, weekCount = weeks) {
	const block = await env.DB.prepare(`INSERT INTO plan_blocks (name, start_date, week_count) VALUES (?, ?, ?) RETURNING id`).bind(name, start, weekCount).first<{ id: number }>();
	const ids: number[] = [];
	for (let w = 0; w < weeks; w++) {
		const id = await insertSession({ date: addDaysIso(start, w * 7), label: `${name} lift`, week_number: w + 1 });
		await env.DB.prepare(`UPDATE sessions SET block_id = ? WHERE id = ?`).bind(block!.id, id).run();
		ids.push(id);
	}
	return { id: block!.id, ids };
}

async function train(sessionId: number) {
	const ex = await insertExercise({ name: `Ex ${sessionId}`, pattern: 'push' });
	await insertLoggedSet(sessionId, ex, { set_index: 1, weight_kg: 20, reps: 8, rir: 2, performed_on: addDaysIso(todayIso(), -1) });
}

async function planFrom(start: string, weeks = 2) {
	const res = await SELF.fetch(`${BASE}/export?weeks=${weeks}&startDate=${start}`);
	return ((await res.json()) as { deterministicProposal: MultiWeekProposalInput }).deterministicProposal;
}

async function importPlan(plan: MultiWeekProposalInput) {
	const imp = await postJson(`${BASE}/import`, plan);
	if (imp.status !== 200) throw new Error(await imp.text());
	return ((await imp.json()) as { id: number }).id;
}

const count = async (sql: string, ...args: unknown[]) => (await env.DB.prepare(sql).bind(...args).first<{ n: number }>())!.n;
const blockRow = (id: number) => env.DB.prepare(`SELECT name, week_count FROM plan_blocks WHERE id = ?`).bind(id).first<{ name: string; week_count: number }>();

describe('new-block accept supersedes older blocks from its start', () => {
	it("deletes the old block's later untouched sessions, trims it, and the replaces count matches", async () => {
		await seedHistory();
		// 8 weeks from S-28: weeks 5..8 (4 sessions) are on/after S, two of them beyond the plan's span.
		const old = await seedBlock('Block 1', addDaysIso(S, -28), 8);
		await train(old.ids[0]);
		const id = await importPlan(await planFrom(S, 2));

		const { pending } = (await (await SELF.fetch(`${BASE}/pending`)).json()) as { pending: { replaces: number } };
		expect(pending.replaces).toBe(4);

		const before = await count(`SELECT COUNT(*) AS n FROM sessions WHERE block_id = ?`, old.id);
		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);
		expect(before - (await count(`SELECT COUNT(*) AS n FROM sessions WHERE block_id = ?`, old.id))).toBe(pending.replaces);
		expect(await count(`SELECT COUNT(*) AS n FROM sessions WHERE block_id = ? AND date >= ?`, old.id, S)).toBe(0);
		expect((await blockRow(old.id))!.week_count).toBe(4);
		expect(await count(`SELECT COUNT(*) AS n FROM planned_sets WHERE session_id IN (?, ?)`, old.ids[4], old.ids[7])).toBe(0);
		const fresh = await env.DB.prepare(`SELECT name, start_date FROM plan_blocks WHERE id != ?`).bind(old.id).first<{ name: string; start_date: string }>();
		expect(fresh).toEqual({ name: 'Block 2', start_date: S });
	});

	it('keeps trained sessions, and the block that holds them', async () => {
		await seedHistory();
		const old = await seedBlock('Block 1', addDaysIso(S, -28), 8);
		await train(old.ids[7]); // week 8, beyond the plan's span
		const id = await importPlan(await planFrom(S, 2));
		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);

		expect(await count(`SELECT COUNT(*) AS n FROM sessions WHERE id = ?`, old.ids[7])).toBe(1);
		expect(await count(`SELECT COUNT(*) AS n FROM logged_sets WHERE session_id = ?`, old.ids[7])).toBe(1);
		expect(await count(`SELECT COUNT(*) AS n FROM sessions WHERE block_id = ? AND date >= ?`, old.id, S)).toBe(1);
		expect((await blockRow(old.id))!.week_count).toBe(8);
	});

	it('deletes a block left with nothing, detaches plans pointing at it, and names the next block past the largest number', async () => {
		await seedHistory();
		const keep = await seedBlock('Block 2', addDaysIso(S, -28), 2);
		const gone = await seedBlock('Block 3', S, 3);
		const gp = await env.DB.prepare(
			`INSERT INTO generated_plans (status, first_week_number, week_count, plan_json, deterministic_json, block_id) VALUES ('accepted', 1, 3, '{}', '{}', ?) RETURNING id`,
		)
			.bind(gone.id)
			.first<{ id: number }>();
		const id = await importPlan(await planFrom(S, 2));
		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);

		expect(await blockRow(gone.id)).toBeNull();
		expect((await env.DB.prepare(`SELECT block_id FROM generated_plans WHERE id = ?`).bind(gp!.id).first<{ block_id: number | null }>())!.block_id).toBeNull();
		expect((await blockRow(keep.id))!.week_count).toBe(2);
		const names = (await env.DB.prepare(`SELECT name FROM plan_blocks ORDER BY id`).all<{ name: string }>()).results.map((r) => r.name);
		expect(names).toEqual(['Block 2', 'Block 3']);
	});

	it('names a new block after the largest existing number, not the count', async () => {
		await seedHistory();
		await seedBlock('Block 2', addDaysIso(S, -28), 2);
		const id = await importPlan(await planFrom(S, 2));
		expect((await postJson(`${BASE}/${id}/accept`)).status).toBe(200);
		const names = (await env.DB.prepare(`SELECT name FROM plan_blocks ORDER BY id`).all<{ name: string }>()).results.map((r) => r.name);
		expect(names).toEqual(['Block 2', 'Block 3']);
	});
});

describe('adjusting a block may not run into another block', () => {
	it('refuses at import (422) and at accept (409), naming the block', async () => {
		await seedHistory();
		const monday = weekStartOnOrAfter(todayIso());
		const mine = await seedBlock('Block 2', addDaysIso(monday, -14), 6);
		const exp = await SELF.fetch(`${BASE}/export?adjust=${mine.id}&weeks=3`);
		const plan = ((await exp.json()) as { deterministicProposal: MultiWeekProposalInput }).deterministicProposal;

		// Another block starts in the middle of the weeks being adjusted.
		const other = await seedBlock('Block 3', addDaysIso(monday, 7), 2);
		const refused = await postJson(`${BASE}/import?adjust=${mine.id}`, plan);
		expect(refused.status).toBe(422);
		expect(((await refused.json()) as { error: string }).error).toMatch(/^Block 3 starts \w{3} \d+ \w{3} — shorten this block or adjust Block 3 instead$/);

		// Clear it, import, then the other block appears before accept.
		await env.DB.prepare(`DELETE FROM sessions WHERE block_id = ?`).bind(other.id).run();
		await env.DB.prepare(`DELETE FROM plan_blocks WHERE id = ?`).bind(other.id).run();
		const ok = await postJson(`${BASE}/import?adjust=${mine.id}`, plan);
		expect(ok.status).toBe(200);
		const { id } = (await ok.json()) as { id: number };
		await seedBlock('Block 3', addDaysIso(monday, 7), 2);
		const accept = await postJson(`${BASE}/${id}/accept`);
		expect(accept.status).toBe(409);
		expect(((await accept.json()) as { error: string }).error).toContain('Block 3 starts');
	});
});

describe('migration 0014_tidy_overlapping_blocks', () => {
	async function runMigration() {
		const m = env.TEST_MIGRATIONS.find((x) => x.name.includes('0014'));
		expect(m).toBeDefined();
		await env.DB.batch(m!.queries.map((q) => env.DB.prepare(q)));
	}
	const snapshot = async () => ({
		blocks: (await env.DB.prepare(`SELECT id, name, start_date, week_count FROM plan_blocks ORDER BY id`).all()).results,
		sessions: (await env.DB.prepare(`SELECT id, block_id, date FROM sessions ORDER BY id`).all()).results,
	});

	it('is a no-op on clean data', async () => {
		await seedBlock('Block 1', addDaysIso(S, -28), 4);
		await seedBlock('Block 2', S, 3);
		const before = await snapshot();
		await runMigration();
		expect(await snapshot()).toEqual(before);
	});

	it('trims overlapped blocks, keeps trained sessions, removes emptied blocks, and is idempotent', async () => {
		const ex = await insertExercise({ name: 'Row', pattern: 'pull' });
		// Block 1 claims 10 weeks (stored count overstates) but has 6 sessions: S-28 .. S+7.
		const b1 = await seedBlock('Block 1', addDaysIso(S, -28), 6, 10);
		await insertPlannedSet(b1.ids[5], ex, { order_index: 1 });
		await insertPlannedRun(b1.ids[4], { run_type: 'easy', target_km: 5, target_minutes: null });
		await train(b1.ids[0]);
		// Block 2: S..S+21, trained at S+14. Block 3 starts at S+14 inside it (chain).
		const b2 = await seedBlock('Block 2', S, 4);
		await train(b2.ids[2]);
		const b3 = await seedBlock('Block 3', addDaysIso(S, 14), 2);
		// Block 4 starts at S+49 with 2 untouched weeks; Block 5 starts the same day, so Block 4 is wholly superseded.
		const b4 = await seedBlock('Block 4', addDaysIso(S, 49), 2);
		await seedBlock('Block 5', addDaysIso(S, 56), 2);
		const gp = await env.DB.prepare(
			`INSERT INTO generated_plans (status, first_week_number, week_count, plan_json, deterministic_json, block_id) VALUES ('accepted', 1, 2, '{}', '{}', ?) RETURNING id`,
		)
			.bind(b4.id)
			.first<{ id: number }>();
		// Block 4's second session sits on Block 5's start; its first is before it, so Block 4 keeps one session.
		// Make both sessions >= Block 5's start so none remain.
		await env.DB.prepare(`UPDATE sessions SET date = ? WHERE id = ?`).bind(addDaysIso(S, 56), b4.ids[0]).run();
		await env.DB.prepare(`UPDATE sessions SET date = ? WHERE id = ?`).bind(addDaysIso(S, 63), b4.ids[1]).run();

		await runMigration();

		// Block 1: untouched sessions on/after S gone, the trained one kept; count trimmed to what remains.
		expect(await count(`SELECT COUNT(*) AS n FROM sessions WHERE block_id = ?`, b1.id)).toBe(4);
		expect((await blockRow(b1.id))!.week_count).toBe(4);
		expect(await count(`SELECT COUNT(*) AS n FROM planned_sets WHERE session_id = ?`, b1.ids[5])).toBe(0);
		expect(await count(`SELECT COUNT(*) AS n FROM planned_runs WHERE session_id = ?`, b1.ids[4])).toBe(0);
		expect(await count(`SELECT COUNT(*) AS n FROM logged_sets WHERE session_id = ?`, b1.ids[0])).toBe(1);
		// Block 2: S+14 onward belongs to Block 3; the trained S+14 session survives and keeps 3 weeks, week 4 goes.
		expect(await count(`SELECT COUNT(*) AS n FROM sessions WHERE id = ?`, b2.ids[2])).toBe(1);
		expect(await count(`SELECT COUNT(*) AS n FROM sessions WHERE id = ?`, b2.ids[3])).toBe(0);
		expect((await blockRow(b2.id))!.week_count).toBe(3);
		// Block 3 untouched; Block 4 emptied and removed, its plan detached.
		expect((await blockRow(b3.id))!.week_count).toBe(2);
		expect(await blockRow(b4.id)).toBeNull();
		expect((await env.DB.prepare(`SELECT block_id FROM generated_plans WHERE id = ?`).bind(gp!.id).first<{ block_id: number | null }>())!.block_id).toBeNull();

		const once = await snapshot();
		await runMigration();
		expect(await snapshot()).toEqual(once);
	});
});

describe('manual runs pick one block', () => {
	it("a date before the later block resolves to the earlier one; the later block owns its own start", async () => {
		const a = await seedBlock('Block 1', addDaysIso(S, -28), 4);
		const b = await seedBlock('Block 2', S, 2);
		const post = async (date: string) => {
			const res = await postJson('https://training-app.test/api/runs', { date, run_type: 'easy', distance_km: 5, duration_seconds: 1800 });
			expect(res.status).toBeLessThan(300);
			return env.DB.prepare(`SELECT block_id FROM sessions WHERE date = ? AND origin = 'manual'`).bind(date).first<{ block_id: number }>();
		};
		expect((await post(addDaysIso(S, -1)))!.block_id).toBe(a.id);
		expect((await post(S))!.block_id).toBe(b.id);
	});
});
