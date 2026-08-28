import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildExportContext, generateNextWeeks, importProposal } from '../src/generator';
import type { MultiWeekProposalInput, WeekProposalInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession } from './fixtures';

async function setDaysPerWeek(n: number) {
	await env.DB.prepare(`UPDATE settings SET days_per_week = ? WHERE id = 1`).bind(n).run();
}

// The clock is an argument, never read inside the module (see ExportPayload's
// doc comment). Every fixture in this file anchors on a week dated 2026-08-03,
// and the proposal shifts forward by whole weeks until every date lands after
// `today` — one week is enough from here, so the +7/+14/+21 dates the
// assertions below use are exactly what a real 2026-08-04 export would emit.
const TODAY = '2026-08-04';

describe('buildExportContext / generateNextWeeks', () => {
	it('produces a deterministic week 1 shifted 7 days forward, with reasons keyed to the new date', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 10, rir: 1, performed_on: '2026-08-03' });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 2, weight_kg: 20, reps: 10, rir: 1, performed_on: '2026-08-03' });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 3, weight_kg: 20, reps: 10, rir: 1, performed_on: '2026-08-03' });

		const context = await generateNextWeeks(env.DB, 1, TODAY);

		expect(context.deterministicProposal.weeks).toHaveLength(1);
		const week1 = context.deterministicProposal.weeks[0];
		expect(week1.week_number).toBe(2);
		expect(week1.sessions).toHaveLength(1);

		const session = week1.sessions[0];
		expect(session.date).toBe('2026-08-10'); // +7 days
		expect(session.kind).toBe('lift');
		expect(session.plannedSets[0].target_weight_kg).toBe(22); // 20 + increment_kg(2): all sets hit top at median RIR 1

		expect(context.reasons[`2026-08-10:${exerciseId}`]).toMatch(/weight increase earned/);
		expect(context.speculativeFromWeek).toBe(2);
		expect(context.exerciseCatalogue.map((e) => e.id)).toContain(exerciseId);
		expect(context.daysPerWeek).toBe(5); // migration default
		expect(context.goals).toBe('');
		expect(context.painFlags).toEqual({ shoulder: false, back: false });
		expect(context.skippedSessions).toEqual([]);
	});

	it('produces weekCount weeks, with weeks 2..N as flat copies of week 1 shifted +7/+14 days', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 10, rir: 1, performed_on: '2026-08-03' });

		const context = await buildExportContext(env.DB, 3, TODAY);

		expect(context.deterministicProposal.weeks).toHaveLength(3);
		const [week1, week2, week3] = context.deterministicProposal.weeks;

		expect(week1.week_number).toBe(2);
		expect(week2.week_number).toBe(3);
		expect(week3.week_number).toBe(4);

		expect(week1.sessions[0].date).toBe('2026-08-10'); // +7 from 2026-08-03
		expect(week2.sessions[0].date).toBe('2026-08-17'); // week1 +7
		expect(week3.sessions[0].date).toBe('2026-08-24'); // week1 +14

		// Weeks 2-3 are flat copies of week 1's values — same label/kind/plannedSets/plannedRun.
		expect(week2.sessions[0].label).toBe(week1.sessions[0].label);
		expect(week2.sessions[0].kind).toBe(week1.sessions[0].kind);
		expect(week2.sessions[0].plannedSets).toEqual(week1.sessions[0].plannedSets);
		expect(week3.sessions[0].plannedSets).toEqual(week1.sessions[0].plannedSets);
		expect(week2.sessions[0].plannedRun).toEqual(week1.sessions[0].plannedRun);

		// No reasons are recorded for the speculative weeks — only week 1's date.
		expect(Object.keys(context.reasons)).toEqual([`2026-08-10:${exerciseId}`]);
		expect(context.speculativeFromWeek).toBe(2);
	});

	it('returns weekCount empty weeks when there are no sessions at all yet', async () => {
		const context = await buildExportContext(env.DB, 3, TODAY);
		expect(context.deterministicProposal).toEqual({
			weeks: [
				{ week_number: 1, sessions: [] },
				{ week_number: 2, sessions: [] },
				{ week_number: 3, sessions: [] },
			],
		});
		expect(context.reasons).toEqual({});
	});
});

describe('importProposal', () => {
	async function seedOneSessionWeek() {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
		// Reps land in range without maxing out -> hold weight (increase_reps), so the
		// deterministic baseline weight stays 20 — a clean starting point for the
		// weight-jump tests below.
		await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: '2026-08-03' });
		await setDaysPerWeek(1); // match the single-session week seeded above
		return { exerciseId, sessionId };
	}

	it('validates and persists a single-week pending row, hydrating exercise names onto the stored plan', async () => {
		const { exerciseId } = await seedOneSessionWeek();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const result = await importProposal(env.DB, context.deterministicProposal, TODAY);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('expected ok');

		const row = await env.DB.prepare(`SELECT * FROM generated_plans WHERE id = ?`)
			.bind(result.id)
			.first<{ status: string; plan_json: string; deterministic_json: string; first_week_number: number; week_count: number; source: string }>();

		expect(row?.status).toBe('pending');
		expect(row?.first_week_number).toBe(2);
		expect(row?.week_count).toBe(1);
		expect(row?.source).toBe('external-import');

		const plan = JSON.parse(row!.plan_json);
		expect(plan.weeks[0].sessions[0].plannedSets[0].exercise_name).toBe('Goblet squat');
		expect(plan.weeks[0].sessions[0].plannedSets[0].pattern).toBe('squat');
		expect(plan.weeks[0].sessions[0].plannedSets[0].exercise_id).toBe(exerciseId);
	});

	it('validates and persists a valid 3-week chain, with first_week_number/week_count correct', async () => {
		await seedOneSessionWeek();
		const context = await buildExportContext(env.DB, 3, TODAY);

		// The flat-copy deterministic proposal is itself a valid chain (each
		// week is identical to the last, so no jump exceeds the cap anywhere).
		const result = await importProposal(env.DB, context.deterministicProposal, TODAY);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('expected ok');

		const row = await env.DB.prepare(`SELECT * FROM generated_plans WHERE id = ?`)
			.bind(result.id)
			.first<{ first_week_number: number; week_count: number; plan_json: string }>();
		expect(row?.first_week_number).toBe(2);
		expect(row?.week_count).toBe(3);

		const plan = JSON.parse(row!.plan_json);
		expect(plan.weeks).toHaveLength(3);
		expect(plan.weeks.map((w: { week_number: number }) => w.week_number)).toEqual([2, 3, 4]);
	});

	it('rejects an empty weeks array with a clear validation error', async () => {
		const result = await importProposal(env.DB, { weeks: [] }, TODAY);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.errors.join(' ')).toMatch(/at least one week/);
	});

	it('rejects a second import while one is already pending', async () => {
		await seedOneSessionWeek();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const first = await importProposal(env.DB, context.deterministicProposal, TODAY);
		expect(first.ok).toBe(true);

		const second = await importProposal(env.DB, context.deterministicProposal, TODAY);
		expect(second.ok).toBe(false);
		if (second.ok) throw new Error('expected failure');
		expect(second.errors.join(' ')).toMatch(/already pending/);
	});

	it('rejects an unknown exercise_id', async () => {
		await seedOneSessionWeek();
		const context = await buildExportContext(env.DB, 1, TODAY);
		const input = JSON.parse(JSON.stringify(context.deterministicProposal)) as MultiWeekProposalInput;
		input.weeks[0].sessions[0].plannedSets[0].exercise_id = 999999;

		const result = await importProposal(env.DB, input, TODAY);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.errors.join(' ')).toMatch(/Unknown exercise_id/);
	});

	it('rejects a weight jump over 10% vs the deterministic baseline in week 1', async () => {
		await seedOneSessionWeek();
		const context = await buildExportContext(env.DB, 1, TODAY);
		const input = JSON.parse(JSON.stringify(context.deterministicProposal)) as MultiWeekProposalInput;
		const baseline = input.weeks[0].sessions[0].plannedSets[0].target_weight_kg!;
		input.weeks[0].sessions[0].plannedSets[0].target_weight_kg = baseline * 1.5; // +50%, way over the 10% cap

		const result = await importProposal(env.DB, input, TODAY);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.errors.join(' ')).toMatch(/exceeds 10%/);
	});

	it('rejects a week-3-vs-week-2 jump over 10% even though week-3-vs-week-1 is a decrease (proves the chain, not a fixed baseline, is checked)', async () => {
		const { exerciseId } = await seedOneSessionWeek();
		const context = await buildExportContext(env.DB, 3, TODAY);
		const template = context.deterministicProposal.weeks[0].sessions[0];

		// week 1 (the real, deterministic-baseline-checked week): weight 20kg —
		// exactly the deterministic baseline, so week 1 itself validates cleanly.
		// week 2: 20kg held — no jump vs week 1.
		// week 3: 26kg — a 30% jump vs week 2's 20kg (MUST fail, exceeds 10%),
		// but week 3 vs week 1's ORIGINAL baseline is also 20->26 (+30%) which
		// would ALSO fail under a fixed-baseline check — so to prove the chain
		// (not a fixed baseline) is actually what's checked, week 1 itself is
		// deliberately a DELOAD from a higher hypothetical value: we set week 1
		// to 20kg (matching the true deterministic baseline, so it passes),
		// week 2 DROPS to 15kg (a deload — decreases are never rejected), then
		// week 3 jumps to 20kg. 20kg vs week 2's 15kg is a +33% jump (must
		// fail); 20kg vs week 1's 20kg is 0% (no jump at all) — a fixed
		// week-1-baseline check would have incorrectly passed this.
		// Dates advance a week at a time: weeks may not overlap, so reusing week
		// 1's date for all three would fail on ordering before the weight chain
		// was ever reached.
		const input: MultiWeekProposalInput = {
			weeks: [
				{
					week_number: 2,
					sessions: [{ ...template, date: '2026-08-10', plannedSets: [{ ...template.plannedSets[0], target_weight_kg: 20 }] }],
				},
				{
					week_number: 3,
					sessions: [{ ...template, date: '2026-08-17', plannedSets: [{ ...template.plannedSets[0], target_weight_kg: 15 }] }],
				},
				{
					week_number: 4,
					sessions: [{ ...template, date: '2026-08-24', plannedSets: [{ ...template.plannedSets[0], target_weight_kg: 20 }] }],
				},
			],
		};

		const result = await importProposal(env.DB, input, TODAY);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.errors.join(' ')).toMatch(new RegExp(`Weight jump for exercise_id ${exerciseId}.*\\(week 4\\) exceeds 10% vs week 3`));
	});

	it('accepts a substituted exercise_id in week 2 with an unconstrained weight (no baseline in week 1 for that id)', async () => {
		await seedOneSessionWeek();
		const otherExerciseId = await insertExercise({ name: 'Leg press', pattern: 'squat', increment_kg: 5 });
		const context = await buildExportContext(env.DB, 2, TODAY);
		const template = context.deterministicProposal.weeks[0].sessions[0];

		const input: MultiWeekProposalInput = {
			weeks: [
				context.deterministicProposal.weeks[0], // unchanged, real week 1 — validates against the true baseline
				{
					week_number: 3,
					sessions: [
						{
							...template,
							date: '2026-08-17', // a week on from week 1 — weeks may not overlap
							plannedSets: [{ ...template.plannedSets[0], exercise_id: otherExerciseId, target_weight_kg: 500 }], // wildly high, but unconstrained: no week-1 entry for this exercise_id
						},
					],
				},
			],
		};

		const result = await importProposal(env.DB, input, TODAY);
		expect(result.ok).toBe(true);
	});
});
