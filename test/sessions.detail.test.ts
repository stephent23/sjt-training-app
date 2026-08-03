import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SessionDetail } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession } from './fixtures';

describe('GET /api/sessions/:id', () => {
	it('prefills lastWeek from the most recent day the exercise was logged, not an older one', async () => {
		const exerciseId = await insertExercise({ name: 'Goblet squat' });
		const olderSessionId = await insertSession({ date: '2026-07-20', label: 'Two weeks ago' });
		const recentSessionId = await insertSession({ date: '2026-07-27', label: 'Last week' });
		const thisSessionId = await insertSession({ date: '2026-08-03', label: 'This week' });

		await insertLoggedSet(olderSessionId, exerciseId, { set_index: 1, weight_kg: 18, reps: 10, rir: 3, rest_taken_seconds: null, performed_on: '2026-07-20' });
		await insertLoggedSet(recentSessionId, exerciseId, { set_index: 1, weight_kg: 20, reps: 8, rir: 2, rest_taken_seconds: null, performed_on: '2026-07-27' });
		await insertPlannedSet(thisSessionId, exerciseId, { order_index: 1, target_sets: 1 });

		const res = await SELF.fetch(`https://training-app.test/api/sessions/${thisSessionId}`);
		const body = (await res.json()) as SessionDetail;

		expect(body.plannedSets[0].lastWeek).toEqual([{ set_index: 1, weight_kg: 20, reps: 8, rir: 2, rest_taken_seconds: null, performed_on: '2026-07-27' }]);
	});

	it('does not pull sets logged against the current session into lastWeek', async () => {
		const exerciseId = await insertExercise({ name: 'Cable row' });
		const sessionId = await insertSession({ date: '2026-08-03' });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 1 });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 1, performed_on: '2026-08-03' });

		const res = await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`);
		const body = (await res.json()) as SessionDetail;

		expect(body.plannedSets[0].lastWeek).toEqual([]);
		expect(body.plannedSets[0].logged).toHaveLength(1);
	});

	it('returns 404 for a session that does not exist', async () => {
		const res = await SELF.fetch('https://training-app.test/api/sessions/999999');
		expect(res.status).toBe(404);
	});
});
