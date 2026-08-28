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

// The clock is an argument, never read inside the module (see ExportPayload's
// doc comment). Every fixture here anchors on a week dated 2026-08-03, and the
// proposal shifts forward by whole weeks until every date lands after `today` —
// one week is enough from here, so the 2026-08-10 baseline the proposals below
// are built around is exactly what a real 2026-08-04 export would emit.
const TODAY = '2026-08-04';

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
		const context = await buildExportContext(env.DB, 1, TODAY);

		expect(validateProposal(context.deterministicProposal, context)).toEqual([]);
	});

	it('rejects a date that is not YYYY-MM-DD', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const errors = validateProposal(proposalOf(liftSession(exerciseId, { date: 'next Monday' })), context);
		expect(errors.join(' ')).toMatch(/invalid date/);
	});

	// The regex alone would let this through; sessions.date has no CHECK
	// constraint, so it would insert fine and then never match a date-ranged
	// Today/History query again.
	it('rejects a well-formatted date that is not a real calendar day', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const errors = validateProposal(proposalOf(liftSession(exerciseId, { date: '2026-02-31' })), context);
		expect(errors.join(' ')).toMatch(/invalid date/);
	});

	it('rejects an unknown session kind before it can hit the D1 CHECK constraint', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const errors = validateProposal(proposalOf(liftSession(exerciseId, { kind: 'swim' as never })), context);
		expect(errors.join(' ')).toMatch(/invalid kind/);
	});

	it('rejects an unknown run_type', async () => {
		await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

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
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session = liftSession(exerciseId);
		session.plannedSets[0].rep_low = 12;
		session.plannedSets[0].rep_high = 3;

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/rep_high .* below rep_low/);
	});

	it('rejects a non-positive target_sets', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session = liftSession(exerciseId);
		session.plannedSets[0].target_sets = 0;

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/invalid target_sets/);
	});

	it('rejects a negative target_weight_kg', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session = liftSession(exerciseId);
		session.plannedSets[0].target_weight_kg = -20;

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/invalid target_weight_kg/);
	});

	it('rejects a run session that carries lift sets', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session = liftSession(exerciseId, { kind: 'run' });
		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/is a run but carries/);
	});

	it('rejects a lift session that carries a run', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session = liftSession(exerciseId, {
			plannedRun: { run_type: 'easy', target_minutes: 30, target_km: null, structure_json: null },
		});
		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/is a lift but carries a plannedRun/);
	});

	it('rejects structure_json that is not parseable JSON', async () => {
		await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

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
		const context = await buildExportContext(env.DB, 1, TODAY);

		const errors = validateProposal(proposalOf(liftSession(exerciseId, { date: 'whenever' })), context);
		expect(errors.every((e) => e.includes('invalid date'))).toBe(true);
	});

	it('importProposal rejects a structurally bad proposal without persisting anything', async () => {
		const { exerciseId } = await seedBaseline();

		const result = await importProposal(env.DB, proposalOf(liftSession(exerciseId, { kind: 'swim' as never })), TODAY);
		expect(result.ok).toBe(false);

		const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM generated_plans`).first<{ n: number }>();
		expect(row?.n).toBe(0);
	});

	// logged_sets is unique on (session_id, exercise_id, set_index), and both
	// logSet and loadSessionDetail key by exercise_id — so two planned rows
	// sharing one exercise in a session make the second one unloggable. POST
	// /api/swaps already 409s on exactly this; import let it straight through.
	it('rejects the same exercise appearing twice in one session', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session = liftSession(exerciseId);
		session.plannedSets.push({ ...session.plannedSets[0], order_index: 2 });

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/appears twice/);
	});

	it('rejects two sessions sharing a date within one week', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const proposal: MultiWeekProposalInput = {
			weeks: [{ week_number: 2, sessions: [liftSession(exerciseId), liftSession(exerciseId, { label: 'Lift B' })] }],
		};

		expect(validateProposal(proposal, context).join(' ')).toMatch(/duplicate date/);
	});

	it('rejects sessions that are not in ascending date order within a week', async () => {
		const { exerciseId } = await seedBaseline();
		await env.DB.prepare(`UPDATE settings SET days_per_week = 2 WHERE id = 1`).run();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const proposal: MultiWeekProposalInput = {
			weeks: [{ week_number: 2, sessions: [liftSession(exerciseId, { date: '2026-08-12' }), liftSession(exerciseId, { date: '2026-08-10' })] }],
		};

		expect(validateProposal(proposal, context).join(' ')).toMatch(/out of date order/);
	});

	it('rejects a week that starts before the previous week has finished', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 2, TODAY);

		const proposal: MultiWeekProposalInput = {
			weeks: [
				{ week_number: 2, sessions: [liftSession(exerciseId, { date: '2026-08-10' })] },
				{ week_number: 3, sessions: [liftSession(exerciseId, { date: '2026-08-09' })] },
			],
		};

		expect(validateProposal(proposal, context).join(' ')).toMatch(/starts on or before/);
	});

	// A run whose structure_json parses but isn't the {steps:[...]} shape used
	// to render it imported happily and then displayed as nothing at all.
	it('rejects structure_json that parses but has no steps array', async () => {
		await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session: ProposedSessionInput = {
			date: '2026-08-10',
			kind: 'run',
			label: 'Intervals',
			plannedSets: [],
			plannedRun: { run_type: 'intervals', target_minutes: 40, target_km: null, structure_json: '{"foo":1}' },
		};

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/steps array/);
	});

	it('rejects a structure_json step that is missing effort', async () => {
		await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session: ProposedSessionInput = {
			date: '2026-08-10',
			kind: 'run',
			label: 'Intervals',
			plannedSets: [],
			plannedRun: {
				run_type: 'intervals',
				target_minutes: 40,
				target_km: null,
				structure_json: '{"steps":[{"kind":"warmup","minutes":10}]}',
			},
		};

		expect(validateProposal(proposalOf(session), context).join(' ')).toMatch(/step 0/);
	});

	it('accepts a well-formed structure_json', async () => {
		await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const session: ProposedSessionInput = {
			date: '2026-08-10',
			kind: 'run',
			label: 'Intervals',
			plannedSets: [],
			plannedRun: {
				run_type: 'intervals',
				target_minutes: 40,
				target_km: null,
				structure_json: '{"steps":[{"kind":"warmup","minutes":10,"effort":"easy"},{"kind":"work","minutes":3,"effort":"hard","repeat":5}]}',
			},
		};

		expect(validateProposal(proposalOf(session), context)).toEqual([]);
	});
});

describe('validateProposal — session counts and deloads', () => {
	async function seedFourDayWeek() {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
		await env.DB.prepare(`UPDATE settings SET days_per_week = 4 WHERE id = 1`).run();
		return { exerciseId };
	}

	function weekOf(exerciseId: number, weekNumber: number, dates: string[]) {
		return { week_number: weekNumber, sessions: dates.map((date) => liftSession(exerciseId, { date })) };
	}

	it('requires week 1 to match days_per_week exactly — it mirrors a real week', async () => {
		const { exerciseId } = await seedFourDayWeek();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const proposal = { weeks: [weekOf(exerciseId, 2, ['2026-08-10', '2026-08-11', '2026-08-12'])] };
		expect(validateProposal(proposal, context).join(' ')).toMatch(/Session count/);
	});

	// A deload that drops a session is real judgement, and used to be
	// un-importable because every week had to equal days_per_week exactly.
	it('lets a later week drop one session for a deload', async () => {
		const { exerciseId } = await seedFourDayWeek();
		const context = await buildExportContext(env.DB, 2, TODAY);

		const proposal: MultiWeekProposalInput = {
			weeks: [
				weekOf(exerciseId, 2, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']),
				{ ...weekOf(exerciseId, 3, ['2026-08-17', '2026-08-18', '2026-08-19']), focus: 'deload' },
			],
		};

		expect(validateProposal(proposal, context)).toEqual([]);
	});

	it('still rejects a later week that drops two sessions', async () => {
		const { exerciseId } = await seedFourDayWeek();
		const context = await buildExportContext(env.DB, 2, TODAY);

		const proposal: MultiWeekProposalInput = {
			weeks: [
				weekOf(exerciseId, 2, ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']),
				weekOf(exerciseId, 3, ['2026-08-17', '2026-08-18']),
			],
		};

		expect(validateProposal(proposal, context).join(' ')).toMatch(/Session count/);
	});

	it('never allows an empty week, even where days_per_week is 1', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 2, TODAY);

		const proposal: MultiWeekProposalInput = {
			weeks: [weekOf(exerciseId, 2, ['2026-08-10']), { week_number: 3, sessions: [] }],
		};

		expect(validateProposal(proposal, context).join(' ')).toMatch(/Session count/);
	});

	it('rejects a focus that is not a non-empty string', async () => {
		const { exerciseId } = await seedBaseline();
		const context = await buildExportContext(env.DB, 1, TODAY);

		const proposal = { weeks: [{ ...weekOf(exerciseId, 2, ['2026-08-10']), focus: '   ' }] };
		expect(validateProposal(proposal, context).join(' ')).toMatch(/invalid focus/);
	});
});

describe('importProposal — collision with sessions already in the database', () => {
	// A plan can now be regenerated over dates that are already scheduled —
	// that's the whole point of re-planning as circumstances change. An
	// untouched (still-planned, nothing logged) session on the proposed date is
	// no longer a reason to refuse; it gets replaced at accept time instead
	// (see test/generator.overwrite.test.ts). Only training that has actually
	// happened is protected, which this test now covers.
	it('refuses a proposal over a date where training has already happened', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
		const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
		await env.DB.prepare(`UPDATE settings SET days_per_week = 1 WHERE id = 1`).run();

		// Someone already trained on the day the proposal wants — completed,
		// not merely scheduled.
		await insertSession({ date: '2026-08-10', label: 'Existing', week_number: 2, status: 'completed' });

		const result = await importProposal(env.DB, proposalOf(liftSession(exerciseId)), TODAY);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.errors.join(' ')).toMatch(/2026-08-10 already has training you've done/);

		const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM generated_plans`).first<{ n: number }>();
		expect(row?.n).toBe(0);
	});
});
