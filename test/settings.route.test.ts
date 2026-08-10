import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

function patchJson(body: unknown) {
	return SELF.fetch('https://training-app.test/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('GET /api/settings', () => {
	it('returns the seeded defaults', async () => {
		const res = await SELF.fetch('https://training-app.test/api/settings');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ goals: '', days_per_week: 5, goal_tags: [] });
	});
});

// Free-text goals are easy to leave vague ("get fitter"), and vague goals are
// exactly what the AI reviewer can't act on. The tags are a fixed vocabulary so
// the prompt can state what each one means.
describe('PATCH /api/settings — goal tags', () => {
	it('stores and returns tags as an array', async () => {
		const res = await patchJson({ goal_tags: ['build_muscle', 'run_endurance', 'protect_shoulder'] });
		expect(res.status).toBe(200);
		expect((await res.json()) as { goal_tags: string[] }).toMatchObject({ goal_tags: ['build_muscle', 'run_endurance', 'protect_shoulder'] });

		const getRes = await SELF.fetch('https://training-app.test/api/settings');
		expect((await getRes.json()) as { goal_tags: string[] }).toMatchObject({ goal_tags: ['build_muscle', 'run_endurance', 'protect_shoulder'] });
	});

	it('rejects a tag outside the known vocabulary', async () => {
		const res = await patchJson({ goal_tags: ['get_swole'] });
		expect(res.status).toBe(400);

		const getRes = await SELF.fetch('https://training-app.test/api/settings');
		expect((await getRes.json()) as { goal_tags: string[] }).toMatchObject({ goal_tags: [] });
	});

	it('rejects a non-array', async () => {
		expect((await patchJson({ goal_tags: 'build_muscle' })).status).toBe(400);
	});

	it('leaves tags alone when the patch does not mention them', async () => {
		await patchJson({ goal_tags: ['lose_fat'] });
		await patchJson({ days_per_week: 3 });

		const getRes = await SELF.fetch('https://training-app.test/api/settings');
		expect(await getRes.json()).toEqual({ goals: '', days_per_week: 3, goal_tags: ['lose_fat'] });
	});

	it('clears tags when given an empty array', async () => {
		await patchJson({ goal_tags: ['lose_fat'] });
		await patchJson({ goal_tags: [] });

		const getRes = await SELF.fetch('https://training-app.test/api/settings');
		expect((await getRes.json()) as { goal_tags: string[] }).toMatchObject({ goal_tags: [] });
	});
});

describe('PATCH /api/settings', () => {
	it('updates goals independently of days_per_week', async () => {
		const res = await patchJson({ goals: 'Build a bigger squat' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ goals: 'Build a bigger squat', days_per_week: 5, goal_tags: [] });

		const getRes = await SELF.fetch('https://training-app.test/api/settings');
		expect(await getRes.json()).toEqual({ goals: 'Build a bigger squat', days_per_week: 5, goal_tags: [] });
	});

	it('updates days_per_week independently of goals', async () => {
		await patchJson({ goals: 'Marathon training' });
		const res = await patchJson({ days_per_week: 4 });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ goals: 'Marathon training', days_per_week: 4, goal_tags: [] });
	});

	it('rejects a days_per_week above 7', async () => {
		const res = await patchJson({ days_per_week: 8 });
		expect(res.status).toBe(400);

		const getRes = await SELF.fetch('https://training-app.test/api/settings');
		expect(await getRes.json()).toEqual({ goals: '', days_per_week: 5, goal_tags: [] });
	});

	it('rejects a days_per_week below 1', async () => {
		const res = await patchJson({ days_per_week: 0 });
		expect(res.status).toBe(400);
	});

	it('rejects a non-integer days_per_week', async () => {
		const res = await patchJson({ days_per_week: 3.5 });
		expect(res.status).toBe(400);
	});
});
