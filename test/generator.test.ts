import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildExportContext, generateNextWeek, importProposal } from '../src/generator';
import type { WeekProposalInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession } from './fixtures';

async function setDaysPerWeek(n: number) {
	await env.DB.prepare(`UPDATE settings SET days_per_week = ? WHERE id = 1`).bind(n).run();
}

describe('buildExportContext / generateNextWeek', () => {
	it('produces a deterministic proposal shifted 7 days forward, with reasons keyed to the new date', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 10, rir: 1, performed_on: '2026-08-03' });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 2, weight_kg: 20, reps: 10, rir: 1, performed_on: '2026-08-03' });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 3, weight_kg: 20, reps: 10, rir: 1, performed_on: '2026-08-03' });

		const context = await generateNextWeek(env.DB);

		expect(context.deterministicProposal.week_number).toBe(2);
		expect(context.deterministicProposal.sessions).toHaveLength(1);

		const session = context.deterministicProposal.sessions[0];
		expect(session.date).toBe('2026-08-10'); // +7 days
		expect(session.kind).toBe('lift');
		expect(session.plannedSets[0].target_weight_kg).toBe(22); // 20 + increment_kg(2): all sets hit top at median RIR 1

		expect(context.reasons[`2026-08-10:${exerciseId}`]).toMatch(/weight increase earned/);
		expect(context.exerciseCatalogue.map((e) => e.id)).toContain(exerciseId);
		expect(context.daysPerWeek).toBe(5); // migration default
		expect(context.goals).toBe('');
		expect(context.painFlags).toEqual({ shoulder: false, back: false });
		expect(context.skippedSessions).toEqual([]);
	});

	it('returns an empty proposal when there are no sessions at all yet', async () => {
		const context = await buildExportContext(env.DB);
		expect(context.deterministicProposal).toEqual({ week_number: 1, sessions: [] });
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

	it('validates and persists a pending row, hydrating exercise names onto the stored plan', async () => {
		const { exerciseId } = await seedOneSessionWeek();
		const context = await buildExportContext(env.DB);

		const result = await importProposal(env.DB, context.deterministicProposal);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error('expected ok');

		const row = await env.DB.prepare(`SELECT * FROM generated_plans WHERE id = ?`)
			.bind(result.id)
			.first<{ status: string; plan_json: string; deterministic_json: string; week_number: number; source: string }>();

		expect(row?.status).toBe('pending');
		expect(row?.week_number).toBe(2);
		expect(row?.source).toBe('external-import');

		const plan = JSON.parse(row!.plan_json);
		expect(plan.sessions[0].plannedSets[0].exercise_name).toBe('Goblet squat');
		expect(plan.sessions[0].plannedSets[0].pattern).toBe('squat');
		expect(plan.sessions[0].plannedSets[0].exercise_id).toBe(exerciseId);
	});

	it('rejects a second import while one is already pending', async () => {
		await seedOneSessionWeek();
		const context = await buildExportContext(env.DB);

		const first = await importProposal(env.DB, context.deterministicProposal);
		expect(first.ok).toBe(true);

		const second = await importProposal(env.DB, context.deterministicProposal);
		expect(second.ok).toBe(false);
		if (second.ok) throw new Error('expected failure');
		expect(second.errors.join(' ')).toMatch(/already pending/);
	});

	it('rejects an unknown exercise_id', async () => {
		await seedOneSessionWeek();
		const context = await buildExportContext(env.DB);
		const input = JSON.parse(JSON.stringify(context.deterministicProposal)) as WeekProposalInput;
		input.sessions[0].plannedSets[0].exercise_id = 999999;

		const result = await importProposal(env.DB, input);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.errors.join(' ')).toMatch(/Unknown exercise_id/);
	});

	it('rejects a weight jump over 10% vs the deterministic baseline', async () => {
		await seedOneSessionWeek();
		const context = await buildExportContext(env.DB);
		const input = JSON.parse(JSON.stringify(context.deterministicProposal)) as WeekProposalInput;
		const baseline = input.sessions[0].plannedSets[0].target_weight_kg!;
		input.sessions[0].plannedSets[0].target_weight_kg = baseline * 1.5; // +50%, way over the 10% cap

		const result = await importProposal(env.DB, input);
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error('expected failure');
		expect(result.errors.join(' ')).toMatch(/exceeds 10%/);
	});
});
