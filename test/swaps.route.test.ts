import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ApplySwapInput, SessionDetail, SwapCandidate } from '../src/types';
import { insertExercise, insertPlannedSet, insertSession } from './fixtures';

describe('GET /api/swaps/candidates/:exerciseId', () => {
	it('only returns exercises sharing the pattern, excluding the exercise itself', async () => {
		const from = await insertExercise({ name: 'Neutral-grip DB press', pattern: 'horizontal_push' });
		await insertExercise({ name: 'Machine chest press', pattern: 'horizontal_push' });
		await insertExercise({ name: 'Cable row', pattern: 'horizontal_pull' });

		const res = await SELF.fetch(`https://training-app.test/api/swaps/candidates/${from}`);
		const body = (await res.json()) as { candidates: SwapCandidate[] };

		expect(body.candidates.map((c) => c.name)).toEqual(['Machine chest press']);
	});

	it('filters to shoulder-safe options when pain=shoulder is passed', async () => {
		const from = await insertExercise({ name: 'Neutral-grip DB press', pattern: 'horizontal_push' });
		await insertExercise({ name: 'Incline DB press', pattern: 'horizontal_push', shoulder_safe: 0 });
		await insertExercise({ name: 'Machine chest press', pattern: 'horizontal_push', shoulder_safe: 1 });

		const res = await SELF.fetch(`https://training-app.test/api/swaps/candidates/${from}?pain=shoulder`);
		const body = (await res.json()) as { candidates: SwapCandidate[] };

		expect(body.candidates.map((c) => c.name)).toEqual(['Machine chest press']);
	});

	it('404s for an exercise that does not exist', async () => {
		const res = await SELF.fetch('https://training-app.test/api/swaps/candidates/999999');
		expect(res.status).toBe(404);
	});
});

describe('POST /api/swaps', () => {
	it('records the swap and repoints this session onto the substitute, clearing the carried weight', async () => {
		const from = await insertExercise({ name: 'Goblet squat', pattern: 'squat', loading: 'total' });
		const to = await insertExercise({ name: 'Leg press', pattern: 'squat', loading: 'total' });
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, from, { order_index: 1, target_weight_kg: 24 });

		const before = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		const plannedSetId = before.plannedSets[0].id;

		const input: ApplySwapInput = { session_id: sessionId, planned_set_id: plannedSetId, from_exercise_id: from, to_exercise_id: to, reason: 'equipment_busy', scope: 'this_session' };
		const res = await SELF.fetch('https://training-app.test/api/swaps', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input),
		});
		expect(res.status).toBe(200);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.plannedSets[0].exercise_name).toBe('Leg press');
		expect(detail.plannedSets[0].target_weight_kg).toBeNull();
	});

	it('with two planned_sets rows sharing the same exercise in one session, only the targeted row is repointed', async () => {
		const shared = await insertExercise({ name: 'Cable fly', pattern: 'isolation_push' });
		const to = await insertExercise({ name: 'Pec deck', pattern: 'isolation_push' });
		const sessionId = await insertSession();
		await insertPlannedSet(sessionId, shared, { order_index: 1 });
		await insertPlannedSet(sessionId, shared, { order_index: 2 }); // e.g. two superset halves sharing an isolation move

		const before = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		const targetId = before.plannedSets[0].id;

		const input: ApplySwapInput = { session_id: sessionId, planned_set_id: targetId, from_exercise_id: shared, to_exercise_id: to, reason: 'preference', scope: 'this_session' };
		await SELF.fetch('https://training-app.test/api/swaps', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });

		const after = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(after.plannedSets.find((p) => p.id === targetId)?.exercise_name).toBe('Pec deck');
		expect(after.plannedSets.find((p) => p.id !== targetId)?.exercise_name).toBe('Cable fly'); // untouched
	});
});
