import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SessionDetail } from '../src/types';
import { insertExercise, insertPlannedSet, insertSession } from './fixtures';

describe('PATCH /api/sessions/:id/exercises/:plannedSetId/status', () => {
	it('marks one exercise skipped without touching another exercise in the same session', async () => {
		const exerciseA = await insertExercise({ name: 'Goblet squat' });
		const exerciseB = await insertExercise({ name: 'Leg press' });
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseA, { order_index: 1 });
		await insertPlannedSet(sessionId, exerciseB, { order_index: 2 });

		const before = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		const targetId = before.plannedSets[0].id;

		const res = await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}/exercises/${targetId}/status`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'skipped' }),
		});
		expect(res.status).toBe(200);

		const after = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(after.plannedSets.find((p) => p.id === targetId)?.status).toBe('skipped');
		expect(after.plannedSets.find((p) => p.id !== targetId)?.status).toBe('planned');
	});

	it('rejects an invalid status', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1 });

		const before = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		const targetId = before.plannedSets[0].id;

		const res = await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}/exercises/${targetId}/status`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'not-a-real-status' }),
		});
		expect(res.status).toBe(400);
	});

	it('does not update the row when the session_id in the URL does not match the planned_set\'s real session', async () => {
		const exerciseId = await insertExercise();
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1 });
		const otherSessionId = await insertSession({ date: '2026-08-04' });

		const before = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		const targetId = before.plannedSets[0].id;

		await SELF.fetch(`https://training-app.test/api/sessions/${otherSessionId}/exercises/${targetId}/status`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ status: 'skipped' }),
		});

		const after = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(after.plannedSets.find((p) => p.id === targetId)?.status).toBe('planned');
	});
});
