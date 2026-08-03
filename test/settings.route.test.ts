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
		expect(body).toEqual({ goals: '', days_per_week: 5 });
	});
});

describe('PATCH /api/settings', () => {
	it('updates goals independently of days_per_week', async () => {
		const res = await patchJson({ goals: 'Build a bigger squat' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ goals: 'Build a bigger squat', days_per_week: 5 });

		const getRes = await SELF.fetch('https://training-app.test/api/settings');
		expect(await getRes.json()).toEqual({ goals: 'Build a bigger squat', days_per_week: 5 });
	});

	it('updates days_per_week independently of goals', async () => {
		await patchJson({ goals: 'Marathon training' });
		const res = await patchJson({ days_per_week: 4 });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ goals: 'Marathon training', days_per_week: 4 });
	});

	it('rejects a days_per_week above 7', async () => {
		const res = await patchJson({ days_per_week: 8 });
		expect(res.status).toBe(400);

		const getRes = await SELF.fetch('https://training-app.test/api/settings');
		expect(await getRes.json()).toEqual({ goals: '', days_per_week: 5 });
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
