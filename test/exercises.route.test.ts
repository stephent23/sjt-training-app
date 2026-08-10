import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Exercise } from '../src/types';
import { insertExercise } from './fixtures';

// Nothing in the app could add an exercise before this: the catalogue was
// whatever the seed put there, so wanting to do something it didn't list meant
// editing SQL.

function postJson(body: unknown) {
	return SELF.fetch('https://training-app.test/api/exercises', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function seedPattern() {
	await insertExercise({ name: 'Goblet squat', pattern: 'squat', increment_kg: 2 });
}

describe('POST /api/exercises', () => {
	it('adds an exercise and fills in sensible defaults', async () => {
		await seedPattern();

		const res = await postJson({ name: 'Hack squat', pattern: 'squat', increment_kg: 5, modality: 'machine' });
		expect(res.status).toBe(200);

		const { exercise } = (await res.json()) as { exercise: Exercise };
		expect(exercise).toMatchObject({
			name: 'Hack squat',
			pattern: 'squat',
			modality: 'machine',
			loading: 'total', // machines load a stack, not a hand
			increment_kg: 5,
			shoulder_safe: 1,
			back_safe: 1,
			needs_spotter: 0,
			is_default: 0, // never displaces the seeded default for its pattern
		});
	});

	it('makes the new exercise available as a swap candidate immediately', async () => {
		await seedPattern();
		const from = await insertExercise({ name: 'Leg press', pattern: 'squat', increment_kg: 5 });

		await postJson({ name: 'Hack squat', pattern: 'squat', increment_kg: 5, modality: 'machine' });

		const res = await SELF.fetch(`https://training-app.test/api/swaps/candidates/${from}`);
		const { candidates } = (await res.json()) as { candidates: Exercise[] };
		expect(candidates.map((c) => c.name)).toContain('Hack squat');
	});

	// A pattern nothing else uses would orphan the exercise from swaps in both
	// directions, since candidates are matched on exact pattern equality.
	it('refuses a movement pattern that does not already exist', async () => {
		await seedPattern();
		const res = await postJson({ name: 'Sled drag', pattern: 'dragging', increment_kg: 5 });
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toMatch(/movement patterns/);
	});

	it('forces a zero increment on bodyweight work', async () => {
		await insertExercise({ name: 'Pull-ups', pattern: 'vertical_pull', increment_kg: 0, loading: 'bodyweight', modality: 'bodyweight' });

		const res = await postJson({ name: 'Chin-ups', pattern: 'vertical_pull', increment_kg: 5, modality: 'bodyweight' });
		const { exercise } = (await res.json()) as { exercise: Exercise };
		expect(exercise.increment_kg).toBe(0);
		expect(exercise.loading).toBe('bodyweight');
	});

	it.each([
		['a blank name', { name: '  ', pattern: 'squat', increment_kg: 2 }],
		['an unknown modality', { name: 'Thing', pattern: 'squat', increment_kg: 2, modality: 'kettlebell' }],
		['a negative increment', { name: 'Thing', pattern: 'squat', increment_kg: -2 }],
	])('rejects %s with a 400 rather than a constraint violation', async (_name, body) => {
		await seedPattern();
		expect((await postJson(body)).status).toBe(400);
	});

	it('refuses a duplicate name, whatever its casing', async () => {
		await seedPattern();
		await postJson({ name: 'Hack squat', pattern: 'squat', increment_kg: 5 });

		const res = await postJson({ name: 'HACK SQUAT', pattern: 'squat', increment_kg: 5 });
		expect(res.status).toBe(409);
	});
});

describe('GET /api/exercises/patterns', () => {
	it('lists the patterns already in use, once each', async () => {
		await insertExercise({ name: 'Goblet squat', pattern: 'squat' });
		await insertExercise({ name: 'Leg press', pattern: 'squat' });
		await insertExercise({ name: 'Cable row', pattern: 'horizontal_pull' });

		const res = await SELF.fetch('https://training-app.test/api/exercises/patterns');
		const { patterns } = (await res.json()) as { patterns: string[] };
		expect(patterns).toEqual(['horizontal_pull', 'squat']);
	});
});
