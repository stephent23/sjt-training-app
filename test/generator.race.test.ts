import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildExportContext, importProposal, validateProposal } from '../src/generator';
import type { MultiWeekProposalInput, ProposedSessionInput } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession } from './fixtures';

// Same anchor as generator.validation.test.ts: baseline week 2026-08-03, new
// plan starts 2026-08-10.
const TODAY = '2026-08-04';

async function seed() {
	const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
	const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
	await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: 20, rest_seconds: 120 });
	await insertLoggedSet(sessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: '2026-08-03' });
	await env.DB.prepare(`UPDATE settings SET days_per_week = 2 WHERE id = 1`).run();
	return exerciseId;
}

const lift = (exerciseId: number, date: string, kg = 20): ProposedSessionInput => ({
	date,
	kind: 'lift',
	label: 'Lift A',
	plannedRun: null,
	plannedSets: [{ exercise_id: exerciseId, order_index: 1, target_sets: 3, rep_low: 8, rep_high: 10, target_weight_kg: kg, rest_seconds: 120, notes: null, superset_group: null }],
});
const longRun = (date: string, km: number): ProposedSessionInput => ({
	date,
	kind: 'run',
	label: 'Long run',
	plannedSets: [],
	plannedRun: { run_type: 'long', target_minutes: null, target_km: km, structure_json: null },
});

function plan(exerciseId: number, km1: number, km2: number, extra: Partial<MultiWeekProposalInput> = {}): MultiWeekProposalInput {
	return {
		weeks: [
			{ week_number: 1, sessions: [lift(exerciseId, '2026-08-10'), longRun('2026-08-11', km1)] },
			{ week_number: 2, sessions: [lift(exerciseId, '2026-08-17'), longRun('2026-08-18', km2)] },
		],
		...extra,
	};
}

const growth = (errors: string[]) => errors.filter((e) => /Long run growth/.test(e));

describe('long-run cap and race day', () => {
	it('still caps ordinary long runs', async () => {
		const id = await seed();
		const context = await buildExportContext(env.DB, 2, TODAY);
		expect(growth(validateProposal(plan(id, 10, 15), context))).toHaveLength(1);
	});

	it('exempts a long run on a race date', async () => {
		const id = await seed();
		const context = await buildExportContext(env.DB, 2, TODAY);
		expect(growth(validateProposal(plan(id, 10, 21.1), context, new Set(['2026-08-18'])))).toEqual([]);
	});

	it('does not let a race-day run become the baseline for the next week', async () => {
		const id = await seed();
		const context = await buildExportContext(env.DB, 2, TODAY);
		// Week 1 long run is the race (21.1 km); week 2 at 40 km would be a huge
		// jump if it were compared, and a 10% cap otherwise only checks real baselines.
		expect(growth(validateProposal(plan(id, 21.1, 40), context, new Set(['2026-08-11'])))).toEqual([]);
		// ...and without the race it is rejected.
		expect(growth(validateProposal(plan(id, 21.1, 40), context))).toHaveLength(1);
	});
});

describe('summary', () => {
	it('rejects a non-string or over-long summary', async () => {
		const id = await seed();
		const context = await buildExportContext(env.DB, 2, TODAY);
		const bad = validateProposal(plan(id, 10, 10, { summary: 42 as unknown as string }), context);
		expect(bad).toEqual(['summary must be a string of at most 1500 characters, or null']);
		expect(validateProposal(plan(id, 10, 10, { summary: 'x'.repeat(1501) }), context)).toHaveLength(1);
		expect(growth(validateProposal(plan(id, 10, 10, { summary: null }), context))).toEqual([]);
	});

	it('carries the summary through import to /pending, and imports without one', async () => {
		const id = await seed();
		const withSummary = plan(id, 21.1, 21.1, { summary: 'Build, sharpen, taper.' });
		// The race-day exemption reaches importProposal through the races table:
		// without the row, week 2's 21.1 km after a 21.1 km long run is fine anyway,
		// so use a jump that only the race can excuse.
		const jumpy = plan(id, 10, 21.1, { summary: 'Build, sharpen, taper.' });
		const result = await importProposal(env.DB, jumpy, TODAY);
		expect(result).toMatchObject({ ok: false });
		await env.DB.prepare(`INSERT INTO races (name, date, distance_km, priority) VALUES ('Race', '2026-08-18', 21.1, 'A')`).run();
		const ok = await importProposal(env.DB, withSummary, TODAY);
		expect(ok.ok).toBe(true);
		const pending = (await (await SELF.fetch('https://training-app.test/api/generator/pending')).json()) as { pending: { plan: { summary?: string } } };
		expect(pending.pending.plan.summary).toBe('Build, sharpen, taper.');

		// no summary: nothing stored under that key
		const bare = await importProposal(env.DB, plan(id, 10, 10), TODAY, true);
		expect(bare.ok).toBe(true);
		const again = (await (await SELF.fetch('https://training-app.test/api/generator/pending')).json()) as { pending: { plan: { summary?: string } } };
		expect(again.pending.plan.summary).toBeUndefined();
	});
});

// Caps compare against the highest earlier value, so a deload does not make the
// return to normal loading look like a jump.
describe('caps against the highest earlier value', () => {
	const chain = (id: number, kgs: number[], runs: number[]): MultiWeekProposalInput => ({
		weeks: kgs.map((kg, i) => ({
			week_number: i + 1,
			sessions: [lift(id, `2026-08-${10 + 7 * i}`, kg), longRun(`2026-08-${11 + 7 * i}`, runs[i])],
		})),
	});
	const jumps = (errors: string[]) => errors.filter((e) => /Weight jump|Long run growth/.test(e));

	it('lets a deload be followed by a return to the previous peak', async () => {
		const id = await seed();
		const context = await buildExportContext(env.DB, 3, TODAY);
		expect(jumps(validateProposal(chain(id, [20, 15, 22], [10, 6, 11]), context))).toEqual([]);
	});

	it('still rejects a jump above 110% of the previous peak', async () => {
		const id = await seed();
		const context = await buildExportContext(env.DB, 3, TODAY);
		const errors = jumps(validateProposal(chain(id, [20, 15, 23], [10, 6, 12]), context));
		expect(errors).toHaveLength(2);
		expect(errors.join(' ')).toMatch(/Weight jump/);
		expect(errors.join(' ')).toMatch(/Long run growth/);
	});

	it('caps the week after a race against the pre-race peak', async () => {
		const id = await seed();
		const context = await buildExportContext(env.DB, 3, TODAY);
		const race = new Set(['2026-08-18']);
		expect(jumps(validateProposal(chain(id, [20, 20, 20], [10, 21.1, 11]), context, race))).toEqual([]);
		expect(jumps(validateProposal(chain(id, [20, 20, 20], [10, 21.1, 12]), context, race))).toHaveLength(1);
	});
});

describe('week 1 and session counts', () => {
	it('accepts added or moved week-1 sessions (no baseline for that slot)', async () => {
		const id = await seed();
		await env.DB.prepare(`UPDATE settings SET days_per_week = 3 WHERE id = 1`).run();
		const context = await buildExportContext(env.DB, 1, TODAY);
		const week1 = { weeks: [{ week_number: 1, sessions: [lift(id, '2026-08-10'), longRun('2026-08-12', 15), lift(id, '2026-08-14', 100)] }] };
		expect(validateProposal(week1, context)).toEqual([]);
	});

	it('lets later weeks drop up to two sessions, but not three', async () => {
		const id = await seed();
		await env.DB.prepare(`UPDATE settings SET days_per_week = 4 WHERE id = 1`).run();
		const context = await buildExportContext(env.DB, 3, TODAY);
		const weeks = (n: number) => ({
			weeks: [
				{ week_number: 1, sessions: [10, 11, 12, 13].map((d) => lift(id, `2026-08-${d}`)) },
				{ week_number: 2, sessions: [17, 18, 19, 20].slice(0, n).map((d) => lift(id, `2026-08-${d}`)) },
			],
		});
		const count = (p: MultiWeekProposalInput) => validateProposal(p, context).filter((e) => /Session count/.test(e));
		expect(count(weeks(2))).toEqual([]);
		expect(count(weeks(1))).toHaveLength(1);
	});
});

describe('export block_week', () => {
	it('places a race in its week of the block, or null outside it', async () => {
		const { buildRaceContext } = await import('../src/raceContext');
		const row = (date: string) => ({ id: 1, name: 'R', date, distance_km: 21.1, target_seconds: null, result_seconds: null, priority: 'A' as const });
		const ctx = buildRaceContext([row('2026-08-10'), row('2026-08-23'), row('2026-08-24'), row('2026-08-09')], '2026-08-04', { startDate: '2026-08-10', weeks: 2 });
		expect(Object.fromEntries(ctx.races.map((r) => [r.date, r.block_week]))).toEqual({ '2026-08-09': null, '2026-08-10': 1, '2026-08-23': 2, '2026-08-24': null });
	});
});
