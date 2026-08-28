import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildExportContext, validateProposal } from '../src/generator';
import { insertExercise, insertLoggedRun, insertLoggedSet, insertPlannedSet, insertSession } from './fixtures';

async function setDaysPerWeek(n: number) {
	await env.DB.prepare(`UPDATE settings SET days_per_week = ? WHERE id = 1`).bind(n).run();
}

// The clock is an argument, never read inside the module — see generator.test.ts's
// TODAY comment. Every fixture here anchors on the same 2026-08-03 week 1, so
// +7 lands on 2026-08-10 exactly as it does everywhere else.
const TODAY = '2026-08-04';

// migrations/0008_manual_runs.sql: a run recorded by hand (origin='manual')
// must not become a template for every future week, but it must still reach
// the assistant reviewing the plan. See src/generator.ts's buildExportContext
// doc comment for why the copy-forward loop has to skip it.
describe('a manual run in the anchor week', () => {
	it('is not among the copied-forward sessions in deterministicProposal.weeks[0]', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat' });
		const liftId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(liftId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(liftId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: '2026-08-03' });

		const manualRunId = await insertSession({ date: '2026-08-05', kind: 'run', label: 'Unplanned 5k', status: 'completed', origin: 'manual', week_number: 1 });
		await insertLoggedRun(manualRunId, { performed_on: '2026-08-05' });

		await setDaysPerWeek(1);

		const context = await buildExportContext(env.DB, 1, TODAY);

		const week1 = context.deterministicProposal.weeks[0];
		expect(week1.sessions).toHaveLength(1);
		expect(week1.sessions[0].label).toBe('Lift A');
		expect(week1.sessions.some((s) => s.label === 'Unplanned 5k')).toBe(false);
	});

	it('still reaches the assistant via historyWindow.loggedRuns, keyed by session id', async () => {
		const exerciseId = await insertExercise();
		const liftId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(liftId, exerciseId, { order_index: 1 });

		const manualRunId = await insertSession({ date: '2026-08-05', kind: 'run', label: 'Unplanned 5k', status: 'completed', origin: 'manual', week_number: 1 });
		await insertLoggedRun(manualRunId, { performed_on: '2026-08-05', distance_km: 5.2 });

		await setDaysPerWeek(1);

		const context = await buildExportContext(env.DB, 1, TODAY);

		const manualEntry = context.historyWindow.loggedRuns.find((r) => r.session_id === manualRunId);
		expect(manualEntry).toBeDefined();
		expect(manualEntry?.distance_km).toBe(5.2);
	});

	// This is the regression that matters most: before origin existed, the
	// manual run got copied into week 1 as a real session, taking the count to
	// days_per_week + 1 — which validateSessionCount rejects, so the export's
	// own output could not be re-imported.
	it('leaves the proposal session count valid when days_per_week matches only the planned sessions', async () => {
		const exerciseId = await insertExercise();
		const liftId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(liftId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(liftId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: '2026-08-03' });

		const manualRunId = await insertSession({ date: '2026-08-05', kind: 'run', label: 'Unplanned 5k', status: 'completed', origin: 'manual', week_number: 1 });
		await insertLoggedRun(manualRunId, { performed_on: '2026-08-05' });

		await setDaysPerWeek(1); // matches the one planned session, not the two sessions on the calendar

		const context = await buildExportContext(env.DB, 1, TODAY);

		const importErrors = validateProposal(context.deterministicProposal, context);
		expect(importErrors).toEqual([]);
	});

	it('does not appear in skippedSessions', async () => {
		const exerciseId = await insertExercise();
		const liftId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(liftId, exerciseId, { order_index: 1 });

		const manualRunId = await insertSession({ date: '2026-08-05', kind: 'run', label: 'Unplanned 5k', status: 'completed', origin: 'manual', week_number: 1 });
		await insertLoggedRun(manualRunId, { performed_on: '2026-08-05' });

		await setDaysPerWeek(1);

		const context = await buildExportContext(env.DB, 1, TODAY);

		expect(context.skippedSessions.some((s) => s.id === manualRunId)).toBe(false);
	});
});
