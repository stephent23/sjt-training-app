import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { buildExportContext } from '../src/generator';
import type { SessionDetail } from '../src/types';
import { insertExercise, insertLoggedSet, insertPlannedSet, insertSession } from './fixtures';

async function putFeedback(sessionId: number, body: unknown) {
	return SELF.fetch(`https://training-app.test/api/sessions/${sessionId}/feedback`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('PUT /api/sessions/:id/feedback', () => {
	it('saves feedback and returns it on the session detail', async () => {
		const sessionId = await insertSession({ date: '2026-08-03' });

		const res = await putFeedback(sessionId, { back_pain_0_3: 1, shoulder_pain_0_3: 0, energy_1_5: 4, note: 'felt strong' });
		expect(res.status).toBe(200);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.feedback).toEqual({ back_pain_0_3: 1, shoulder_pain_0_3: 0, energy_1_5: 4, note: 'felt strong' });
	});

	it('returns null feedback for a session that has none', async () => {
		const sessionId = await insertSession({ date: '2026-08-03' });

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.feedback).toBeNull();
	});

	// The write goes through the offline sync queue, which retries — a second
	// delivery must update the row, not fail on the primary key.
	it('upserts rather than duplicating when the same session is submitted twice', async () => {
		const sessionId = await insertSession({ date: '2026-08-03' });

		await putFeedback(sessionId, { back_pain_0_3: 0, shoulder_pain_0_3: 0, energy_1_5: 3, note: null });
		await putFeedback(sessionId, { back_pain_0_3: 3, shoulder_pain_0_3: 2, energy_1_5: 1, note: 'rough' });

		const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM session_feedback WHERE session_id = ?`).bind(sessionId).first<{ n: number }>();
		expect(row?.n).toBe(1);

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.feedback?.back_pain_0_3).toBe(3);
		expect(detail.feedback?.note).toBe('rough');
	});

	it('accepts partial feedback, leaving the unsupplied fields null', async () => {
		const sessionId = await insertSession({ date: '2026-08-03' });

		await putFeedback(sessionId, { shoulder_pain_0_3: 2 });

		const detail = (await (await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`)).json()) as SessionDetail;
		expect(detail.feedback).toEqual({ back_pain_0_3: null, shoulder_pain_0_3: 2, energy_1_5: null, note: null });
	});

	// A D1 CHECK violation would 500, and the sync queue retries 5xx forever —
	// so out-of-range input has to fail fast as a 4xx instead.
	it('rejects an out-of-range pain score with 400, not a 500 from the CHECK constraint', async () => {
		const sessionId = await insertSession({ date: '2026-08-03' });

		expect((await putFeedback(sessionId, { back_pain_0_3: 9 })).status).toBe(400);
		expect((await putFeedback(sessionId, { shoulder_pain_0_3: -1 })).status).toBe(400);
	});

	it('rejects an out-of-range energy score with 400', async () => {
		const sessionId = await insertSession({ date: '2026-08-03' });

		expect((await putFeedback(sessionId, { energy_1_5: 0 })).status).toBe(400);
		expect((await putFeedback(sessionId, { energy_1_5: 6 })).status).toBe(400);
	});
});

describe('feedback drives the generator pain flags', () => {
	// The clock is an argument to buildExportContext, never read inside it. The
	// week seeded below is dated 2026-08-03, so 2026-08-04 is the day after it —
	// close enough that the proposal's single +7 shift already clears today.
	const TODAY = '2026-08-04';

	async function seedWeekWithFeedback(pain: { back?: number; shoulder?: number }) {
		const exerciseId = await insertExercise({ name: 'Bench', pattern: 'horizontal_push' });
		const sessionId = await insertSession({ date: '2026-08-03', label: 'Lift A', week_number: 1 });
		await insertPlannedSet(sessionId, exerciseId, { order_index: 1, target_weight_kg: 20 });
		await insertLoggedSet(sessionId, exerciseId, { set_index: 1, performed_on: '2026-08-03' });
		await putFeedback(sessionId, { back_pain_0_3: pain.back ?? 0, shoulder_pain_0_3: pain.shoulder ?? 0, energy_1_5: 3, note: null });
		return sessionId;
	}

	it('leaves both flags false when nothing hurt', async () => {
		await seedWeekWithFeedback({});

		const context = await buildExportContext(env.DB, 1, TODAY);
		expect(context.painFlags).toEqual({ shoulder: false, back: false });
	});

	// 1 is "noticed it" — not enough to start banning exercises.
	it('does not trip a flag at a pain score of 1', async () => {
		await seedWeekWithFeedback({ shoulder: 1, back: 1 });

		const context = await buildExportContext(env.DB, 1, TODAY);
		expect(context.painFlags).toEqual({ shoulder: false, back: false });
	});

	it('trips only the relevant flag at 2 or above', async () => {
		await seedWeekWithFeedback({ shoulder: 2 });

		const context = await buildExportContext(env.DB, 1, TODAY);
		expect(context.painFlags).toEqual({ shoulder: true, back: false });
	});

	it('trips the back flag at 3', async () => {
		await seedWeekWithFeedback({ back: 3 });

		const context = await buildExportContext(env.DB, 1, TODAY);
		expect(context.painFlags).toEqual({ shoulder: false, back: true });
	});
});
