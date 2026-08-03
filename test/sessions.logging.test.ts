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

		const first: LogRunInput = { distance_km: 5, duration_seconds: 1800, avg_hr: 140, rpe_1_10: 4, performed_on: '2026-08-03', note: null };
		const second: LogRunInput = { distance_km: 5.2, duration_seconds: 1850, avg_hr: 145, rpe_1_10: 5, performed_on: '2026-08-03', note: 'felt tired' };

		await postJson(`https://training-app.test/api/sessions/${sessionId}/runs`, first);
		await postJson(`https://training-app.test/api/sessions/${sessionId}/runs`, second);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.loggedRun).toEqual(second);
	});

	it('rejects a negative distance_km with 400', async () => {
		const sessionId = await insertSession({ kind: 'run', label: 'Easy run' });
		const res = await postJson(`https://training-app.test/api/sessions/${sessionId}/runs`, {
			distance_km: -1,
			duration_seconds: 1800,
			avg_hr: null,
			rpe_1_10: null,
			performed_on: '2026-08-03',
			note: null,
		} satisfies LogRunInput);
		expect(res.status).toBe(400);
	});

	it('rejects an out-of-range rpe_1_10 with 400', async () => {
		const sessionId = await insertSession({ kind: 'run', label: 'Easy run' });
		const res = await postJson(`https://training-app.test/api/sessions/${sessionId}/runs`, {
			distance_km: 5,
			duration_seconds: 1800,
			avg_hr: null,
			rpe_1_10: 11,
			performed_on: '2026-08-03',
			note: null,
		} satisfies LogRunInput);
		expect(res.status).toBe(400);
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
