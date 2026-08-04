import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { SessionSummary } from '../src/types';
import { insertExercise, insertLoggedRun, insertLoggedSet, insertPlannedRun, insertPlannedSet, insertSession } from './fixtures';

async function fetchSessions(qs: string) {
	const res = await SELF.fetch(`https://training-app.test/api/sessions${qs}`);
	const body = (await res.json()) as { sessions: SessionSummary[] };
	return { res, sessions: body.sessions };
}

describe('GET /api/sessions', () => {
	it('filters by from/to date range', async () => {
		await insertSession({ date: '2026-07-01', label: 'Too early' });
		const inRangeId = await insertSession({ date: '2026-07-15', label: 'In range' });
		await insertSession({ date: '2026-08-01', label: 'Too late' });

		const { sessions } = await fetchSessions('?from=2026-07-10&to=2026-07-20');
		expect(sessions).toHaveLength(1);
		expect(sessions[0].id).toBe(inRangeId);
	});

	it('omitting from includes sessions from before today, not just today onward — this is how History queries', async () => {
		const pastId = await insertSession({ date: '2026-07-01', label: 'Yesterday-ish' });

		const { sessions } = await fetchSessions('?to=2026-08-01&order=desc');
		expect(sessions.map((s) => s.id)).toContain(pastId);
	});

	it('order=desc reverses the default ascending order', async () => {
		const firstId = await insertSession({ date: '2026-07-01', label: 'First' });
		const secondId = await insertSession({ date: '2026-07-08', label: 'Second' });
		const thirdId = await insertSession({ date: '2026-07-15', label: 'Third' });

		const asc = await fetchSessions('?from=2026-07-01&to=2026-07-15&order=asc');
		expect(asc.sessions.map((s) => s.id)).toEqual([firstId, secondId, thirdId]);

		const desc = await fetchSessions('?from=2026-07-01&to=2026-07-15&order=desc');
		expect(desc.sessions.map((s) => s.id)).toEqual([thirdId, secondId, firstId]);
	});

	it('a run session with zero planned sets reports exercise_count 0 and planned_set_count 0, not a missing row', async () => {
		const sessionId = await insertSession({ date: '2026-07-01', kind: 'run', label: 'Easy run' });
		await insertPlannedRun(sessionId, { run_type: 'easy', target_minutes: 30 });

		const { sessions } = await fetchSessions('?from=2026-07-01&to=2026-07-01');
		expect(sessions).toHaveLength(1);
		expect(sessions[0].exercise_count).toBe(0);
		expect(sessions[0].planned_set_count).toBe(0);
	});

	it('planned_set_count sums target_sets across exercises, not just the exercise count', async () => {
		const sessionId = await insertSession({ date: '2026-07-01', label: 'Lift' });
		const ex1 = await insertExercise({ name: 'Squat' });
		const ex2 = await insertExercise({ name: 'Bench' });
		await insertPlannedSet(sessionId, ex1, { order_index: 1, target_sets: 3 });
		await insertPlannedSet(sessionId, ex2, { order_index: 2, target_sets: 4 });

		const { sessions } = await fetchSessions('?from=2026-07-01&to=2026-07-01');
		expect(sessions[0].exercise_count).toBe(2);
		expect(sessions[0].planned_set_count).toBe(7);
	});

	it('logged_set_count reflects how many sets have actually been logged', async () => {
		const sessionId = await insertSession({ date: '2026-07-01', label: 'Lift' });
		const exerciseId = await insertExercise();
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_sets: 3 });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 1 });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 2 });

		const { sessions } = await fetchSessions('?from=2026-07-01&to=2026-07-01');
		expect(sessions[0].logged_set_count).toBe(2);
	});

	it('a run session carries run_type/target_minutes and has_logged_run false when nothing has been logged', async () => {
		const sessionId = await insertSession({ date: '2026-07-01', kind: 'run', label: 'Tempo run' });
		await insertPlannedRun(sessionId, { run_type: 'tempo', target_minutes: 40 });

		const { sessions } = await fetchSessions('?from=2026-07-01&to=2026-07-01');
		expect(sessions[0].run_type).toBe('tempo');
		expect(sessions[0].target_minutes).toBe(40);
		expect(sessions[0].has_logged_run).toBe(false);
	});

	it('has_logged_run is true once a run has been logged', async () => {
		const sessionId = await insertSession({ date: '2026-07-01', kind: 'run', label: 'Tempo run' });
		await insertPlannedRun(sessionId, { run_type: 'tempo', target_minutes: 40 });
		await insertLoggedRun(sessionId, { performed_on: '2026-07-01' });

		const { sessions } = await fetchSessions('?from=2026-07-01&to=2026-07-01');
		expect(sessions[0].has_logged_run).toBe(true);
	});

	it('reports correct, distinct counts for multiple sessions in one call — catches a join fanning out incorrectly', async () => {
		const exercise = await insertExercise();

		const oneId = await insertSession({ date: '2026-07-01', label: 'One exercise' });
		await insertPlannedSet(oneId, exercise, { order_index: 1, target_sets: 5 });

		const twoId = await insertSession({ date: '2026-07-02', label: 'Two exercises' });
		await insertPlannedSet(twoId, exercise, { order_index: 1, target_sets: 3 });
		await insertPlannedSet(twoId, exercise, { order_index: 2, target_sets: 3 });

		const threeId = await insertSession({ date: '2026-07-03', label: 'Three exercises' });
		await insertPlannedSet(threeId, exercise, { order_index: 1, target_sets: 2 });
		await insertPlannedSet(threeId, exercise, { order_index: 2, target_sets: 2 });
		await insertPlannedSet(threeId, exercise, { order_index: 3, target_sets: 2 });

		const { sessions } = await fetchSessions('?from=2026-07-01&to=2026-07-03&order=asc');
		expect(sessions).toHaveLength(3);

		const byId = new Map(sessions.map((s) => [s.id, s]));
		expect(byId.get(oneId)?.exercise_count).toBe(1);
		expect(byId.get(oneId)?.planned_set_count).toBe(5);
		expect(byId.get(twoId)?.exercise_count).toBe(2);
		expect(byId.get(twoId)?.planned_set_count).toBe(6);
		expect(byId.get(threeId)?.exercise_count).toBe(3);
		expect(byId.get(threeId)?.planned_set_count).toBe(6);
	});

	it('defaults to a limit of 60, truncating a longer list', async () => {
		for (let i = 0; i < 65; i++) {
			await insertSession({ date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, week_number: Math.floor(i / 7) + 1, label: `Session ${i}` });
		}

		const { sessions } = await fetchSessions('?from=2026-01-01&to=2026-12-31');
		expect(sessions).toHaveLength(60);
	});

	it('respects an explicit limit', async () => {
		for (let i = 0; i < 5; i++) {
			await insertSession({ date: `2026-01-0${i + 1}`, label: `Session ${i}` });
		}

		const { sessions } = await fetchSessions('?from=2026-01-01&to=2026-12-31&limit=2');
		expect(sessions).toHaveLength(2);
	});
});
