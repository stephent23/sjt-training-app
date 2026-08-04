import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildExportContext, importProposal, validateProposal } from '../src/generator';
import type { MultiWeekProposalInput, ProposedSessionInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession } from './fixtures';

// Structural validation of a pasted-back proposal. Before this existed,
// validateProposal only checked weights, so a proposal with a bad `kind`,
// `run_type` or date sailed through import and blew up (or silently corrupted
// data) at ACCEPT time — after the row had been stored and shown for review,
// and part-way through a non-atomic insert loop.

async function seedBaseline() {
	const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
	const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
	await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
	await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: '2026-08-03' });
	await env.DB.prepare(`UPDATE settings SET days_per_week = 1 WHERE id = 1`).run();
	return { exerciseId };
}

function liftSession(exerciseId: number, overrides: Partial<ProposedSessionInput> = {}): ProposedSessionInput {
	return {
		date: '2026-08-10',
		kind: 'lift',
		label: 'Lift A',
		plannedRun: null,
		plannedSets: [
			{ exercise_id: exerciseId, order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120, notes: null, superset_group: null },
		],
		...overrides,
	};
}

function proposalOf(session: ProposedSessionInput): MultiWeekProposalInput {
	return { weeks: [{ week_number: 2, sessions: [session] }] };
}

describe('validateProposal — structural checks', () => {
	it('accepts the deterministic proposal it was given', async () => {
		await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		expect(validateProposal(context.deterministicProposal, context)).toEqual([]);
	});

	it('rejects a date that is not YYYY-MM-DD', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const errors = validateProposal(proposalOf(liftSession(exerciseId, { date: 'next Monday' })), context);
		expect(errors.join(' ')).toMatch(/invalid date/);
	});

	// The regex alone would let this through; sessions.date has no CHECK
	// constraint, so it would insert fine and then never match a date-ranged
	// Today/History query again.
	it('rejects a well-formatted date that is not a real calendar day', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const errors = validateProposal(proposalOf(liftSession(exerciseId, { date: '2026-02-31' })), context);
		expect(errors.join(' ')).toMatch(/invalid date/);
	});

	it('rejects an unknown session kind before it can hit the D1 CHECK constraint', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const errors = validateProposal(proposalOf(liftSession(exerciseId, { kind: 'swim' as never })), context);
		expect(errors.join(' ')).toMatch(/invalid kind/);
	});

	it('rejects an unknown run_type', async () => {
		await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const session: ProposedSessionInput = {
			date: '2026-08-10',
			kind: 'run',
			label: 'Fartlek',
			plannedSets: [],
			plannedRun: { run_type: 'fartlek' as never, target_minutes: 30, target_km: null, structure_json: null },
		};

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/invalid run_type/);
	});

	it('rejects rep_high below rep_low', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const session = liftSession(exerciseId);
		session.plannedSets[0].rep_low = 12;
		session.plannedSets[0].rep_high = 3;

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/rep_high .* below rep_low/);
	});

	it('rejects a non-positive target_sets', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const session = liftSession(exerciseId);
		session.plannedSets[0].target_sets = 0;

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/invalid target_sets/);
	});

	it('rejects a negative target_weight_kg', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const session = liftSession(exerciseId);
		session.plannedSets[0].target_weight_kg = -20;

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/invalid target_weight_kg/);
	});

	it('rejects a run session that carries lift sets', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const session = liftSession(exerciseId, { kind: 'run' });
		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/is a run but carries/);
	});

	it('rejects a lift session that carries a run', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const session = liftSession(exerciseId, {
			plannedRun: { run_type: 'easy', target_minutes: 30, target_km: null, structure_json: null },
		});
		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/is a lift but carries a plannedRun/);
	});

	it('rejects structure_json that is not parseable JSON', async () => {
		await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const session: ProposedSessionInput = {
			date: '2026-08-10',
			kind: 'run',
			label: 'Intervals',
			plannedSets: [],
			plannedRun: { run_type: 'intervals', target_minutes: 40, target_km: null, structure_json: '{not json' },
		};

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/not valid JSON/);
	});

	it('reports structural errors alone, without piling on baseline errors from the same garbage', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1);

		const errors = validateProposal(proposalOf(liftSession(exerciseId, { date: 'whenever' })), context);
		expect(errors.every((e) => e.includes('invalid date'))).toBe(true);
	});

	it('importProposal rejects a structurally bad proposal without persisting anything', async () => {
		const { exerciseId } = await seedBaseline();

		const result = await importProposal(env.DB, proposalOf(liftSession(exerciseId, { kind: 'swim' as never })));
		expect(result.ok).toBe(false);

		const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM generated_plans`).first<{ n: number }>();
		expect(row?.n).toBe(0);
	});
});
