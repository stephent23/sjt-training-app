import { describe, expect, it } from 'vitest';
import { mergeUnsyncedLogs } from '../../src/client/useSession';
import type { LoggedSetEntry, PlannedSetDetail, SessionDetail } from '../../src/types';

// useSession used to throw away the whole server response whenever anything was
// queued for the session, so any change made server-side mid-session stayed
// invisible. Swapping an exercise is exactly that — and because the discarded
// copy carried the new exercise's `loading`, swapping pull-ups for a lat
// pulldown left the row insisting it was bodyweight, with nowhere to type a
// weight.

function plannedSet(overrides: Partial<PlannedSetDetail> = {}): PlannedSetDetail {
	return {
		id: 1,
		exercise_id: 10,
		exercise_name: 'Pull-ups',
		pattern: 'vertical_pull',
		loading: 'bodyweight',
		increment_kg: 0,
		order_index: 1,
		target_sets: 3,
		rep_low: 6,
		rep_high: 10,
		target_weight_kg: null,
		rest_seconds: 120,
		notes: null,
		status: 'planned',
		superset_group: null,
		lastWeek: [],
		logged: [],
		...overrides,
	};
}

function logged(setIndex: number): LoggedSetEntry {
	return { set_index: setIndex, weight_kg: 40, reps: 8, rir: 2, rest_taken_seconds: null, performed_on: '2026-08-10' };
}

function detail(plannedSets: PlannedSetDetail[]): SessionDetail {
	return {
		session: { id: 1, date: '2026-08-10', kind: 'lift', label: 'Lift B', status: 'planned', week_number: 2 },
		plannedSets,
		plannedRun: null,
		loggedRun: null,
		feedback: null,
	};
}

describe('mergeUnsyncedLogs', () => {
	it('takes the server copy wholesale when there is nothing cached', () => {
		const fresh = detail([plannedSet()]);
		expect(mergeUnsyncedLogs(fresh, null)).toBe(fresh);
	});

	it('picks up a swap made server-side while keeping nothing that belonged to the old exercise', () => {
		const cached = detail([plannedSet({ logged: [logged(1)] })]);
		const swapped = detail([
			plannedSet({ exercise_id: 11, exercise_name: 'Lat pulldown', loading: 'total', increment_kg: 5, logged: [] }),
		]);

		const merged = mergeUnsyncedLogs(swapped, cached);

		// The whole point: the new exercise's loading survives, so a weight can be entered.
		expect(merged.plannedSets[0].loading).toBe('total');
		expect(merged.plannedSets[0].exercise_name).toBe('Lat pulldown');
		// And the pull-up sets don't follow it across.
		expect(merged.plannedSets[0].logged).toEqual([]);
	});

	it('keeps unsynced sets for an exercise that did not change', () => {
		const cached = detail([plannedSet({ logged: [logged(1), logged(2)] })]);
		const fresh = detail([plannedSet({ logged: [logged(1)] })]); // server has only the first

		const merged = mergeUnsyncedLogs(fresh, cached);

		expect(merged.plannedSets[0].logged).toHaveLength(2);
	});

	it('still takes the prescription from the server for an unchanged exercise', () => {
		const cached = detail([plannedSet({ target_weight_kg: 20, logged: [logged(1)] })]);
		const fresh = detail([plannedSet({ target_weight_kg: 22 })]);

		const merged = mergeUnsyncedLogs(fresh, cached);

		expect(merged.plannedSets[0].target_weight_kg).toBe(22);
		expect(merged.plannedSets[0].logged).toHaveLength(1);
	});

	it('keeps a locally logged run the server has not seen yet', () => {
		const cached: SessionDetail = {
			...detail([]),
			loggedRun: {
				distance_km: 8,
				duration_seconds: 2400,
				avg_hr: null,
				max_hr: null,
				avg_cadence_spm: null,
				elevation_gain_m: null,
				aerobic_training_effect: null,
				rpe_1_10: 5,
				performed_on: '2026-08-10',
				note: null,
			},
		};

		expect(mergeUnsyncedLogs(detail([]), cached).loggedRun?.distance_km).toBe(8);
	});

	it('drops a planned set the server no longer has', () => {
		const cached = detail([plannedSet({ id: 1 }), plannedSet({ id: 2, exercise_id: 12 })]);
		const merged = mergeUnsyncedLogs(detail([plannedSet({ id: 1 })]), cached);

		expect(merged.plannedSets).toHaveLength(1);
	});
});
