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

// "From now on" used to write its scope to exercise_swaps and do nothing else,
// so it behaved identically to "just today" while the UI promised otherwise.
describe('POST /api/swaps — scope', () => {
	async function seedThreeWeeks() {
		const from = await insertExercise({ name: 'Goblet squat', pattern: 'squat', loading: 'total' });
		const to = await insertExercise({ name: 'Leg press', pattern: 'squat', loading: 'total' });

		const today = await insertSession({ date: '2026-08-10', week_number: 1 });
		const next = await insertSession({ date: '2026-08-17', week_number: 2 });
		const later = await insertSession({ date: '2026-08-24', week_number: 3 });
		const past = await insertSession({ date: '2026-08-03', week_number: 0 });

		for (const session of [today, next, later, past]) await insertPlannedSet(session, from, { order_index: 1, target_weight_kg: 24 });

		// insertPlannedSet doesn't hand back an id, so read it off the session.
		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${today}`)).json()) as SessionDetail;
		return { from, to, today, next, later, past, plannedSetId: detail.plannedSets[0].id };
	}

	async function exerciseIdsFor(sessionId: number): Promise<number[]> {
		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		return detail.plannedSets.map((ps) => ps.exercise_id);
	}

	function swapBody(seed: Awaited<ReturnType<typeof seedThreeWeeks>>, scope: 'this_session' | 'permanent'): ApplySwapInput {
		return { session_id: seed.today, planned_set_id: seed.plannedSetId, from_exercise_id: seed.from, to_exercise_id: seed.to, reason: 'preference', scope };
	}

	it('leaves future sessions alone for a just-today swap', async () => {
		const seed = await seedThreeWeeks();
		await SELF.fetch('https://training-app.test/api/swaps', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(swapBody(seed, 'this_session')),
		});

		expect(await exerciseIdsFor(seed.today)).toEqual([seed.to]);
		expect(await exerciseIdsFor(seed.next)).toEqual([seed.from]);
	});

	it('repoints every future planned session for a from-now-on swap', async () => {
		const seed = await seedThreeWeeks();
		await SELF.fetch('https://training-app.test/api/swaps', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(swapBody(seed, 'permanent')),
		});

		expect(await exerciseIdsFor(seed.today)).toEqual([seed.to]);
		expect(await exerciseIdsFor(seed.next)).toEqual([seed.to]);
		expect(await exerciseIdsFor(seed.later)).toEqual([seed.to]);
	});

	it('leaves the past alone — a week already trained keeps what was actually done', async () => {
		const seed = await seedThreeWeeks();
		await SELF.fetch('https://training-app.test/api/swaps', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(swapBody(seed, 'permanent')),
		});

		expect(await exerciseIdsFor(seed.past)).toEqual([seed.from]);
	});

	it('skips a future session that already contains the substitute, rather than duplicating it', async () => {
		const seed = await seedThreeWeeks();
		await insertPlannedSet(seed.next, seed.to, { order_index: 2 });

		await SELF.fetch('https://training-app.test/api/swaps', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(swapBody(seed, 'permanent')),
		});

		// Still one of each — the duplicate the clash guard exists to prevent
		// must not be created by the bulk update either.
		expect((await exerciseIdsFor(seed.next)).sort()).toEqual([seed.from, seed.to].sort());
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

	// Two planned_sets rows pointing at one exercise would share a single
	// logged-set history and overwrite each other, because logged_sets is
	// unique on (session_id, exercise_id, set_index).
	it('rejects a swap onto an exercise already present in the session', async () => {
		const sessionId = await insertSession({ date: '2026-08-05' });
		const from = await insertExercise({ name: 'DB curl', pattern: 'elbow_flexion' });
		const alreadyThere = await insertExercise({ name: 'Cable curl', pattern: 'elbow_flexion' });
		await insertPlannedSet(sessionId, from, { order_index: 1 });
		await insertPlannedSet(sessionId, alreadyThere, { order_index: 2 });

		const before = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		const fromSetId = before.plannedSets[0].id;

		const input: ApplySwapInput = {
			session_id: sessionId,
			planned_set_id: fromSetId,
			from_exercise_id: from,
			to_exercise_id: alreadyThere,
			reason: 'preference',
			scope: 'this_session',
		};
		const res = await SELF.fetch('https://training-app.test/api/swaps', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(input),
		});

		expect(res.status).toBe(409);

		const after = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(after.plannedSets[0].exercise_name).toBe('DB curl');
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
