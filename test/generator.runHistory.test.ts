import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildExportContext } from '../src/generator';
import { insertExercise, insertLoggedRun, insertLoggedSet, insertPlannedRun, insertPlannedSet, insertSession } from './fixtures';

// Two weeks of run history isn't enough to see a real trend — runs happen
// less often per week than lift sessions and vary more (pace, terrain,
// recovery), so historyWindow.loggedRuns now reaches back RUN_HISTORY_WEEKS
// (6) from the anchor week rather than just the anchor and the week before
// it. Lift history is untouched — the deterministic weight-progression
// formula only ever needs the immediately preceding week, and a longer lift
// history would just bloat the export for no benefit.
const TODAY = '2026-08-04';

describe('buildExportContext — loggedRuns reaches back further than loggedSets', () => {
	it('includes a run from three weeks before the anchor, but not a lift set from the same week', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat' });

		// Week 10 sets the anchor.
		const anchorLiftId = await insertSession({ date: '2026-06-01', label: 'Lift A', week_number: 10 });
		await insertPlannedSet(anchorLiftId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(anchorLiftId, exerciseId, { set_index: 1, weight_kg: 20, reps: 9, rir: 2, performed_on: '2026-06-01' });

		// Week 7 — three weeks back: inside the 6-week run window, well outside
		// the 2-week lift window ([9, 10]).
		const midRunId = await insertSession({ date: '2026-05-11', kind: 'run', label: 'Mid-window run', week_number: 7 });
		await insertLoggedRun(midRunId, { performed_on: '2026-05-11', distance_km: 8 });

		const midLiftId = await insertSession({ date: '2026-05-12', label: 'Mid-window lift', week_number: 7 });
		await insertPlannedSet(midLiftId, exerciseId, { order_index: 1 });
		await insertLoggedSet(midLiftId, exerciseId, { set_index: 1, performed_on: '2026-05-12' });

		const context = await buildExportContext(env.DB, 1, TODAY);

		expect(context.historyWindow.loggedRuns.some((r) => r.session_id === midRunId)).toBe(true);
		expect(context.historyWindow.loggedSets.some((s) => s.session_id === midLiftId)).toBe(false);
	});

	it('includes a run logged exactly six weeks before the anchor (the oldest week still in range)', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat' });
		const anchorLiftId = await insertSession({ date: '2026-06-01', label: 'Lift A', week_number: 10 });
		await insertPlannedSet(anchorLiftId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(anchorLiftId, exerciseId, { set_index: 1, performed_on: '2026-06-01' });

		// Week 5 = anchor(10) - 5: the oldest week the 6-week window still covers.
		const oldestInRangeRunId = await insertSession({ date: '2026-04-20', kind: 'run', label: 'Oldest in range', week_number: 5 });
		await insertLoggedRun(oldestInRangeRunId, { performed_on: '2026-04-20' });

		const context = await buildExportContext(env.DB, 1, TODAY);

		expect(context.historyWindow.loggedRuns.some((r) => r.session_id === oldestInRangeRunId)).toBe(true);
	});

	it('excludes a run logged seven weeks before the anchor (one week outside the window)', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat' });
		const anchorLiftId = await insertSession({ date: '2026-06-01', label: 'Lift A', week_number: 10 });
		await insertPlannedSet(anchorLiftId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(anchorLiftId, exerciseId, { set_index: 1, performed_on: '2026-06-01' });

		// Week 4 = anchor(10) - 6: one week older than the window covers.
		const tooOldRunId = await insertSession({ date: '2026-04-13', kind: 'run', label: 'Too old', week_number: 4 });
		await insertLoggedRun(tooOldRunId, { performed_on: '2026-04-13' });

		const context = await buildExportContext(env.DB, 1, TODAY);

		expect(context.historyWindow.loggedRuns.some((r) => r.session_id === tooOldRunId)).toBe(false);
	});

	// The existing anchor-and-prior-week behaviour must still hold — this
	// isn't a case the wider window should ever have broken, but it's the
	// scenario every other generator test fixture relies on implicitly.
	it('still includes runs from the anchor week and the week immediately before it', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat' });
		const anchorLiftId = await insertSession({ date: '2026-06-01', label: 'Lift A', week_number: 10 });
		await insertPlannedSet(anchorLiftId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(anchorLiftId, exerciseId, { set_index: 1, performed_on: '2026-06-01' });

		const anchorRunId = await insertSession({ date: '2026-06-02', kind: 'run', label: 'Anchor week run', week_number: 10 });
		await insertLoggedRun(anchorRunId, { performed_on: '2026-06-02' });

		const priorRunId = await insertSession({ date: '2026-05-25', kind: 'run', label: 'Prior week run', week_number: 9 });
		await insertLoggedRun(priorRunId, { performed_on: '2026-05-25' });

		const context = await buildExportContext(env.DB, 1, TODAY);

		expect(context.historyWindow.loggedRuns.some((r) => r.session_id === anchorRunId)).toBe(true);
		expect(context.historyWindow.loggedRuns.some((r) => r.session_id === priorRunId)).toBe(true);
	});

	// A run recorded by hand is deliberately excluded from the copy-forward
	// template (migrations/0008_manual_runs.sql), but its logged data must
	// still reach the assistant — the wider window can't accidentally
	// reintroduce an origin filter that was never there for the 2-week case.
	it('includes a manual run from within the wider window', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat', pattern: 'squat' });
		const anchorLiftId = await insertSession({ date: '2026-06-01', label: 'Lift A', week_number: 10 });
		await insertPlannedSet(anchorLiftId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(anchorLiftId, exerciseId, { set_index: 1, performed_on: '2026-06-01' });

		const manualRunId = await insertSession({
			date: '2026-05-04',
			kind: 'run',
			label: 'Unplanned 5k',
			status: 'completed',
			origin: 'manual',
			week_number: 6,
		});
		await insertLoggedRun(manualRunId, { performed_on: '2026-05-04' });

		const context = await buildExportContext(env.DB, 1, TODAY);

		expect(context.historyWindow.loggedRuns.some((r) => r.session_id === manualRunId)).toBe(true);
	});
});
