import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { LogRunInput, LogSetInput, SessionDetail } from '../src/types';
import { insertExercise, insertPlannedSet, insertSession } from './fixtures';

function postJson(url: string, body: unknown) {
	return SELF.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/sessions/:id/sets', () => {
	it('logs a set and it shows up on the session detail', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3 });

		const input: LogSetInput = { exercise_id: exerciseId, set_index: 1, weight_kg: 20, reps: 8, rir: 2, rest_taken_seconds: 130, performed_on: '2026-08-03' };
		const res = await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, input);
		expect(res.status).toBe(200);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.plannedSets[0].logged).toEqual([{ set_index: 1, weight_kg: 20, reps: 8, rir: 2, rest_taken_seconds: 130, performed_on: '2026-08-03' }]);
	});

	it('re-logging the same session/exercise/set_index updates in place rather than duplicating', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3 });

		const first: LogSetInput = { exercise_id: exerciseId, set_index: 1, weight_kg: 20, reps: 8, rir: 2, rest_taken_seconds: 130, performed_on: '2026-08-03' };
		const second: LogSetInput = { exercise_id: exerciseId, set_index: 1, weight_kg: 22.5, reps: 6, rir: 0, rest_taken_seconds: 180, performed_on: '2026-08-03' };

		await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, first);
		await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, second);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.plannedSets[0].logged).toEqual([{ set_index: 1, weight_kg: 22.5, reps: 6, rir: 0, rest_taken_seconds: 180, performed_on: '2026-08-03' }]);
	});

	it('logging different set_index values for the same exercise keeps both', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3 });

		await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, {
			exercise_id: exerciseId,
			set_index: 1,
			weight_kg: 20,
			reps: 8,
			rir: 2,
			rest_taken_seconds: null,
			performed_on: '2026-08-03',
		} satisfies LogSetInput);
		await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, {
			exercise_id: exerciseId,
			set_index: 2,
			weight_kg: 20,
			reps: 7,
			rir: 1,
			rest_taken_seconds: null,
			performed_on: '2026-08-03',
		} satisfies LogSetInput);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.plannedSets[0].logged).toHaveLength(2);
	});

	it('rejects an out-of-range rir with 400 instead of letting the D1 CHECK constraint 500', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3 });

		const tooHigh = await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, {
			exercise_id: exerciseId,
			set_index: 1,
			weight_kg: 20,
			reps: 8,
			rir: 9,
			rest_taken_seconds: null,
			performed_on: '2026-08-03',
		} satisfies LogSetInput);
		expect(tooHigh.status).toBe(400);

		const negative = await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, {
			exercise_id: exerciseId,
			set_index: 1,
			weight_kg: 20,
			reps: 8,
			rir: -1,
			rest_taken_seconds: null,
			performed_on: '2026-08-03',
		} satisfies LogSetInput);
		expect(negative.status).toBe(400);
	});

	it('rejects negative reps with 400', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3 });

		const res = await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, {
			exercise_id: exerciseId,
			set_index: 1,
			weight_kg: 20,
			reps: -1,
			rir: 2,
			rest_taken_seconds: null,
			performed_on: '2026-08-03',
		} satisfies LogSetInput);
		expect(res.status).toBe(400);
	});

	it('rejects a non-numeric weight_kg with 400', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3 });

		const res = await postJson(`https://training-app.test/api/sessions/${sessionId}/sets`, {
			exercise_id: exerciseId,
			set_index: 1,
			weight_kg: 'heavy',
			reps: 8,
			rir: 2,
			rest_taken_seconds: null,
			performed_on: '2026-08-03',
		});
		expect(res.status).toBe(400);
	});
});

describe('POST /api/sessions/:id/runs', () => {
	it('logs a run and re-logging updates it rather than creating a second one', async () => {
		const sessionId = await insertSession({ kind: 'run', label: 'Easy run' });

		const first: LogRunInput = {
			distance_km: 5,
			duration_seconds: 1800,
			avg_hr: 140,
			max_hr: null,
			avg_cadence_spm: null,
			elevation_gain_m: null,
			aerobic_training_effect: null,
			rpe_1_10: 4,
			interval_pace_seconds_per_km: null,
			performed_on: '2026-08-03',
			note: null,
		};
		const second: LogRunInput = {
			distance_km: 5.2,
			duration_seconds: 1850,
			avg_hr: 145,
			max_hr: 172,
			avg_cadence_spm: 168,
			elevation_gain_m: 84.5,
			aerobic_training_effect: 3.4,
			rpe_1_10: 5,
			interval_pace_seconds_per_km: 272,
			performed_on: '2026-08-03',
			note: 'felt tired',
		};

		await postJson(`https://training-app.test/api/sessions/${sessionId}/runs`, first);
		await postJson(`https://training-app.test/api/sessions/${sessionId}/runs`, second);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.loggedRun).toEqual(second);
	});

	// The sync queue drops 4xx permanently but retries 5xx forever, so anything
	// a D1 constraint or a nonsense value could blow up on has to 400 here.
	function runBody(overrides: Partial<LogRunInput>): LogRunInput {
		return {
			distance_km: 5,
			duration_seconds: 1800,
			avg_hr: null,
			max_hr: null,
			avg_cadence_spm: null,
			elevation_gain_m: null,
			aerobic_training_effect: null,
			rpe_1_10: null,
			interval_pace_seconds_per_km: null,
			performed_on: '2026-08-03',
			note: null,
			...overrides,
		};
	}

	it.each([
		['distance_km', { distance_km: -1 }],
		['rpe_1_10', { rpe_1_10: 11 }],
		['avg_hr', { avg_hr: 900 }],
		['max_hr', { max_hr: 0 }],
		['avg_cadence_spm', { avg_cadence_spm: 5000 }],
		['elevation_gain_m', { elevation_gain_m: -5 }],
		['aerobic_training_effect', { aerobic_training_effect: 9 }],
		['a non-integer avg_hr', { avg_hr: 140.5 }],
		['interval_pace_seconds_per_km below its minimum', { interval_pace_seconds_per_km: 89 }],
		['interval_pace_seconds_per_km above its maximum', { interval_pace_seconds_per_km: 1201 }],
		['a non-integer interval_pace_seconds_per_km', { interval_pace_seconds_per_km: 272.5 }],
	])('rejects an out-of-range %s with 400', async (_name, overrides) => {
		const sessionId = await insertSession({ kind: 'run', label: 'Easy run' });
		const res = await postJson(`https://training-app.test/api/sessions/${sessionId}/runs`, runBody(overrides as Partial<LogRunInput>));
		expect(res.status).toBe(400);
	});

	it('accepts and stores a valid interval_pace_seconds_per_km', async () => {
		const sessionId = await insertSession({ kind: 'run', label: 'Intervals' });
		const res = await postJson(
			`https://training-app.test/api/sessions/${sessionId}/runs`,
			runBody({ interval_pace_seconds_per_km: 272 }),
		);
		expect(res.status).toBe(200);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.loggedRun).toMatchObject({ interval_pace_seconds_per_km: 272 });
	});

	it('accepts a run with every watch field omitted', async () => {
		const sessionId = await insertSession({ kind: 'run', label: 'Easy run' });
		const res = await postJson(`https://training-app.test/api/sessions/${sessionId}/runs`, runBody({}));
		expect(res.status).toBe(200);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.loggedRun).toMatchObject({
			max_hr: null,
			avg_cadence_spm: null,
			elevation_gain_m: null,
			aerobic_training_effect: null,
			interval_pace_seconds_per_km: null,
		});
	});
});

describe('PATCH /api/sessions/:id/status', () => {
	it('updates session status', async () => {
		const sessionId = await insertSession({ status: 'planned' });
		const res = await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}/status`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'completed' }),
		});
		expect(res.status).toBe(200);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.session.status).toBe('completed');
	});

	it('rejects an invalid status', async () => {
		const sessionId = await insertSession();
		const res = await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}/status`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'not-a-real-status' }),
		});
		expect(res.status).toBe(400);
	});
});

describe('PATCH /api/sessions/:id/date', () => {
	it('moves a session to a different date', async () => {
		const sessionId = await insertSession({ date: '2026-08-03' });
		const res = await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}/date`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ date: '2026-08-05' }),
		});
		expect(res.status).toBe(200);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.session.date).toBe('2026-08-05');
	});

	it('rejects a malformed date', async () => {
		const sessionId = await insertSession();
		const res = await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}/date`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ date: '05/08/2026' }),
		});
		expect(res.status).toBe(400);
	});
});
