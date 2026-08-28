import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ManualRunInput, SessionDetail, SessionSummary } from '../src/types';
import { insertLoggedRun, insertPlannedRun, insertSession } from './fixtures';

function sendJson(method: string, url: string, body: unknown) {
	return SELF.fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

function postJson(url: string, body: unknown) {
	return sendJson('POST', url, body);
}

function putJson(url: string, body: unknown) {
	return sendJson('PUT', url, body);
}

function runBody(overrides: Partial<ManualRunInput> = {}): ManualRunInput {
	return {
		date: '2026-08-12',
		run_type: 'easy',
		distance_km: 8.2,
		duration_seconds: 2700,
		avg_hr: null,
		max_hr: null,
		avg_cadence_spm: null,
		elevation_gain_m: null,
		aerobic_training_effect: null,
		rpe_1_10: null,
		note: null,
		...overrides,
	};
}

/** POST a manual run and hand back the id, so the many tests that only care
 * about editing or deleting one don't each restate the creation body. */
async function createRun(overrides: Partial<ManualRunInput> = {}): Promise<number> {
	const res = await postJson('https://training-app.test/api/runs', runBody(overrides));
	expect(res.status).toBe(200);
	const { id } = (await res.json()) as { id: number };
	return id;
}

async function fetchDetail(sessionId: number): Promise<SessionDetail> {
	const res = await SELF.fetch(`https://training-app.test/api/sessions/${sessionId}`);
	expect(res.status).toBe(200);
	return (await res.json()) as SessionDetail;
}

async function countRows(table: string, sessionId: number): Promise<number> {
	const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id = ?`).bind(sessionId).first<{ n: number }>();
	return row?.n ?? 0;
}

describe('POST /api/runs', () => {
	it('creates the session, the planned run and the logged run in one go', async () => {
		const id = await createRun({
			date: '2026-08-12',
			run_type: 'tempo',
			distance_km: 10.4,
			duration_seconds: 3120,
			avg_hr: 158,
			max_hr: 176,
			avg_cadence_spm: 172,
			elevation_gain_m: 96.5,
			aerobic_training_effect: 3.8,
			rpe_1_10: 7,
			note: 'windy',
		});

		const detail = await fetchDetail(id);
		expect(detail.session.date).toBe('2026-08-12');
		expect(detail.session.kind).toBe('run');
		expect(detail.plannedRun).toMatchObject({ run_type: 'tempo' });
		expect(detail.loggedRun).toEqual({
			distance_km: 10.4,
			duration_seconds: 3120,
			avg_hr: 158,
			max_hr: 176,
			avg_cadence_spm: 172,
			elevation_gain_m: 96.5,
			aerobic_training_effect: 3.8,
			rpe_1_10: 7,
			performed_on: '2026-08-12',
			note: 'windy',
		});
	});

	// A run you have already been out and done is finished by definition — if it
	// landed as 'planned' it would show up on Today as something still to do.
	it('marks the session completed rather than planned', async () => {
		const id = await createRun();

		const detail = await fetchDetail(id);
		expect(detail.session.status).toBe('completed');
	});

	// origin is the whole reason migration 0008 exists: the export copies the
	// anchor week's sessions forward to build the next plan, and a run that was
	// never planned must not become a fixture of every future week.
	it("stamps origin 'manual' so the export will not copy the run into next week's plan", async () => {
		const id = await createRun();

		const detail = await fetchDetail(id);
		expect(detail.session.origin).toBe('manual');
	});

	// The client sends no label at all — a second name for "easy run" would be a
	// second thing to keep in step with the run type.
	it.each([
		['easy', 'Easy run'],
		['tempo', 'Tempo run'],
		['intervals', 'Intervals run'],
		['long', 'Long run'],
	])('derives the label for a %s run as "%s"', async (runType, expected) => {
		const id = await createRun({ run_type: runType as ManualRunInput['run_type'] });

		const detail = await fetchDetail(id);
		expect(detail.session.label).toBe(expected);
	});

	it('shows up on the session list like any other run', async () => {
		await createRun({ date: '2026-08-12', run_type: 'long', distance_km: 18, duration_seconds: 6600 });

		const res = await SELF.fetch('https://training-app.test/api/sessions?from=2026-08-12&to=2026-08-12');
		const { sessions } = (await res.json()) as { sessions: SessionSummary[] };
		expect(sessions).toHaveLength(1);
		expect(sessions[0]).toMatchObject({ kind: 'run', label: 'Long run', run_type: 'long', has_logged_run: true, logged_distance_km: 18 });
	});

	it('accepts a run with every watch metric left blank — only distance and duration are copied off the watch by hand', async () => {
		const id = await createRun();

		const detail = await fetchDetail(id);
		expect(detail.loggedRun).toMatchObject({
			avg_hr: null,
			max_hr: null,
			avg_cadence_spm: null,
			elevation_gain_m: null,
			aerobic_training_effect: null,
			rpe_1_10: null,
			note: null,
		});
	});
});

// week_number is inherited from the run's neighbours in the calendar, never
// MAX+1: a run recorded in the middle of week 4 belongs to week 4, and giving
// it a brand-new week number would split the week the history window and the
// export both read by.
describe('POST /api/runs week_number inheritance', () => {
	it('takes the week of the nearest session on or before the run date', async () => {
		await insertSession({ date: '2026-08-03', week_number: 4 });
		await insertSession({ date: '2026-08-17', week_number: 6 });

		const id = await createRun({ date: '2026-08-12' });

		const detail = await fetchDetail(id);
		expect(detail.session.week_number).toBe(4);
	});

	it('takes the week of a session dated on the same day', async () => {
		await insertSession({ date: '2026-08-10', week_number: 4 });
		await insertSession({ date: '2026-08-12', week_number: 5 });

		const id = await createRun({ date: '2026-08-12' });

		const detail = await fetchDetail(id);
		expect(detail.session.week_number).toBe(5);
	});

	// "Nearest on or before" beats "nearest overall" — otherwise a run done the
	// day before a new block starts would be filed under the new block.
	it('prefers the preceding session even when a later one is closer', async () => {
		await insertSession({ date: '2026-08-01', week_number: 2 });
		await insertSession({ date: '2026-08-13', week_number: 9 });

		const id = await createRun({ date: '2026-08-12' });

		const detail = await fetchDetail(id);
		expect(detail.session.week_number).toBe(2);
	});

	it('falls back to the nearest later session when nothing precedes the run', async () => {
		await insertSession({ date: '2026-08-17', week_number: 6 });
		await insertSession({ date: '2026-08-24', week_number: 7 });

		const id = await createRun({ date: '2026-08-10' });

		const detail = await fetchDetail(id);
		expect(detail.session.week_number).toBe(6);
	});

	it('uses week 1 when there is nothing in the plan at all', async () => {
		const id = await createRun({ date: '2026-08-12' });

		const detail = await fetchDetail(id);
		expect(detail.session.week_number).toBe(1);
	});
});

// The run editor validates the same bounds client-side, but nothing stops a
// stale client or a replayed request, and a D1 CHECK violation would surface as
// a 500 — which the offline sync queue retries forever. Bad input has to fail
// fast as a 400.
describe('POST /api/runs validation', () => {
	it.each([
		['a date in the wrong format', { date: '12/08/2026' }],
		['a date that is not a date at all', { date: 'yesterday' }],
		['a missing date', { date: '' }],
	])('rejects %s with 400', async (_name, overrides) => {
		const res = await postJson('https://training-app.test/api/runs', runBody(overrides as Partial<ManualRunInput>));
		expect(res.status).toBe(400);
	});

	it.each([
		['an unknown run_type', { run_type: 'recovery' }],
		['a missing run_type', { run_type: null }],
		['a zero distance_km', { distance_km: 0 }],
		['a negative distance_km', { distance_km: -5 }],
		['a non-numeric distance_km', { distance_km: 'far' }],
		['a zero duration_seconds', { duration_seconds: 0 }],
		['a negative duration_seconds', { duration_seconds: -60 }],
		['a fractional duration_seconds', { duration_seconds: 1800.5 }],
		['a non-numeric duration_seconds', { duration_seconds: '30 mins' }],
	])('rejects %s with 400', async (_name, overrides) => {
		const res = await postJson('https://training-app.test/api/runs', runBody(overrides as Partial<ManualRunInput>));
		expect(res.status).toBe(400);
	});

	// One case per RUN_METRIC_FIELDS bound, so a bound that gets dropped from the
	// shared list stops being enforced loudly rather than silently.
	it.each([
		['avg_hr below its minimum', { avg_hr: 19 }],
		['avg_hr above its maximum', { avg_hr: 251 }],
		['a non-integer avg_hr', { avg_hr: 140.5 }],
		['max_hr below its minimum', { max_hr: 0 }],
		['max_hr above its maximum', { max_hr: 300 }],
		['a non-integer max_hr', { max_hr: 176.2 }],
		['avg_cadence_spm below its minimum', { avg_cadence_spm: 10 }],
		['avg_cadence_spm above its maximum', { avg_cadence_spm: 301 }],
		['a non-integer avg_cadence_spm', { avg_cadence_spm: 168.4 }],
		['a negative elevation_gain_m', { elevation_gain_m: -1 }],
		['elevation_gain_m above its maximum', { elevation_gain_m: 10001 }],
		['a negative aerobic_training_effect', { aerobic_training_effect: -0.5 }],
		['aerobic_training_effect above its maximum', { aerobic_training_effect: 5.1 }],
		['rpe_1_10 below its minimum', { rpe_1_10: 0 }],
		['rpe_1_10 above its maximum', { rpe_1_10: 11 }],
		['a non-integer rpe_1_10', { rpe_1_10: 7.5 }],
	])('rejects %s with 400', async (_name, overrides) => {
		const res = await postJson('https://training-app.test/api/runs', runBody(overrides as Partial<ManualRunInput>));
		expect(res.status).toBe(400);
	});

	it('accepts fractional values on the metrics that allow them', async () => {
		const id = await createRun({ elevation_gain_m: 84.5, aerobic_training_effect: 3.4 });

		const detail = await fetchDetail(id);
		expect(detail.loggedRun).toMatchObject({ elevation_gain_m: 84.5, aerobic_training_effect: 3.4 });
	});

	it('writes nothing when the body is rejected', async () => {
		await postJson('https://training-app.test/api/runs', runBody({ distance_km: -5 }));

		const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM sessions`).first<{ n: number }>();
		expect(row?.n).toBe(0);
	});
});

describe('PUT /api/runs/:id', () => {
	it('corrects the date, run type and numbers of a run already recorded', async () => {
		const id = await createRun({ date: '2026-08-12', run_type: 'easy', distance_km: 8.2, duration_seconds: 2700 });

		const res = await putJson(
			`https://training-app.test/api/runs/${id}`,
			runBody({ date: '2026-08-13', run_type: 'long', distance_km: 21.1, duration_seconds: 7200, rpe_1_10: 8, note: 'half marathon' }),
		);
		expect(res.status).toBe(200);

		const detail = await fetchDetail(id);
		expect(detail.session.date).toBe('2026-08-13');
		expect(detail.session.label).toBe('Long run');
		expect(detail.plannedRun).toMatchObject({ run_type: 'long' });
		expect(detail.loggedRun).toMatchObject({
			distance_km: 21.1,
			duration_seconds: 7200,
			rpe_1_10: 8,
			performed_on: '2026-08-13',
			note: 'half marathon',
		});
	});

	// The label is derived on edit as well as on create — otherwise changing a
	// run from easy to tempo would leave a session still called "Easy run".
	it('re-derives the label from the new run type', async () => {
		const id = await createRun({ run_type: 'easy' });

		await putJson(`https://training-app.test/api/runs/${id}`, runBody({ run_type: 'intervals' }));

		const detail = await fetchDetail(id);
		expect(detail.session.label).toBe('Intervals run');
	});

	// Editing a *planned* run's record is the main way this route gets used, so
	// the prescription it was planned against has to survive the edit. An upsert
	// that rewrote the whole planned_runs row would blank target_minutes and
	// target_km, and the plan would lose what it had asked for.
	it('leaves target_minutes and target_km untouched when it upserts the run type', async () => {
		const sessionId = await insertSession({ date: '2026-08-12', kind: 'run', label: 'Easy run' });
		await insertPlannedRun(sessionId, { run_type: 'easy', target_minutes: 40, target_km: 8 });

		const res = await putJson(`https://training-app.test/api/runs/${sessionId}`, runBody({ date: '2026-08-12', run_type: 'tempo' }));
		expect(res.status).toBe(200);

		const detail = await fetchDetail(sessionId);
		expect(detail.plannedRun?.run_type).toBe('tempo');
		expect(detail.plannedRun?.target_minutes).toBe(40);
		expect(detail.plannedRun?.target_km).toBe(8);
	});

	it('records a run against a planned run session that had no logged run yet', async () => {
		const sessionId = await insertSession({ date: '2026-08-12', kind: 'run', label: 'Easy run', status: 'planned' });
		await insertPlannedRun(sessionId, { run_type: 'easy', target_minutes: 40 });

		const res = await putJson(
			`https://training-app.test/api/runs/${sessionId}`,
			runBody({ date: '2026-08-12', distance_km: 7.5, duration_seconds: 2400 }),
		);
		expect(res.status).toBe(200);

		const detail = await fetchDetail(sessionId);
		expect(detail.loggedRun).toMatchObject({ distance_km: 7.5, duration_seconds: 2400 });
	});

	// The API only ever shows one planned run and one logged run per session, so
	// a duplicate row would hide behind the read path until it corrupted a count
	// somewhere else. Counted straight off D1 for that reason.
	it('editing twice leaves exactly one planned_runs row and one logged_runs row', async () => {
		const sessionId = await insertSession({ date: '2026-08-12', kind: 'run', label: 'Easy run' });

		await putJson(`https://training-app.test/api/runs/${sessionId}`, runBody({ date: '2026-08-12', run_type: 'easy' }));
		await putJson(`https://training-app.test/api/runs/${sessionId}`, runBody({ date: '2026-08-12', run_type: 'tempo' }));

		expect(await countRows('planned_runs', sessionId)).toBe(1);
		expect(await countRows('logged_runs', sessionId)).toBe(1);

		const detail = await fetchDetail(sessionId);
		expect(detail.plannedRun?.run_type).toBe('tempo');
	});

	it('404s for a session that does not exist', async () => {
		const res = await putJson('https://training-app.test/api/runs/999', runBody());
		expect(res.status).toBe(404);
	});

	// A lift session has planned_sets, not a run type. Writing a planned_runs row
	// against it would produce a session that reads as both at once.
	it('409s when the session is a lift, and leaves it alone', async () => {
		const sessionId = await insertSession({ kind: 'lift', label: 'Lift A' });

		const res = await putJson(`https://training-app.test/api/runs/${sessionId}`, runBody());
		expect(res.status).toBe(409);

		const detail = await fetchDetail(sessionId);
		expect(detail.session.label).toBe('Lift A');
		expect(detail.plannedRun).toBeNull();
		expect(detail.loggedRun).toBeNull();
	});

	it.each([
		['a malformed date', { date: '13/08/2026' }],
		['an unknown run_type', { run_type: 'recovery' }],
		['a zero distance_km', { distance_km: 0 }],
		['a fractional duration_seconds', { duration_seconds: 1800.5 }],
		['an out-of-range avg_hr', { avg_hr: 900 }],
	])('rejects %s with 400', async (_name, overrides) => {
		const id = await createRun();

		const res = await putJson(`https://training-app.test/api/runs/${id}`, runBody(overrides as Partial<ManualRunInput>));
		expect(res.status).toBe(400);
	});
});

describe('DELETE /api/runs/:id', () => {
	/** A manual run built straight from fixtures, so the delete tests still say
	 * something if POST /api/runs is the thing that is broken. */
	async function insertManualRun(date = '2026-08-12'): Promise<number> {
		const sessionId = await insertSession({ date, kind: 'run', label: 'Easy run', status: 'completed', origin: 'manual' });
		await insertPlannedRun(sessionId, { run_type: 'easy', target_minutes: null });
		await insertLoggedRun(sessionId, { performed_on: date });
		return sessionId;
	}

	it('deletes the session and every child row it owns', async () => {
		const id = await insertManualRun();
		await sendJson('PUT', `https://training-app.test/api/sessions/${id}/feedback`, {
			back_pain_0_3: 0,
			shoulder_pain_0_3: 0,
			energy_1_5: 4,
			note: 'easy day',
		});

		const res = await SELF.fetch(`https://training-app.test/api/runs/${id}`, { method: 'DELETE' });
		expect(res.status).toBe(200);

		expect((await SELF.fetch(`https://training-app.test/api/sessions/${id}`)).status).toBe(404);
		expect(await countRows('planned_runs', id)).toBe(0);
		expect(await countRows('logged_runs', id)).toBe(0);
		expect(await countRows('session_feedback', id)).toBe(0);
	});

	// Recording a run and immediately taking it back out is the mistake this
	// route exists to undo, so the two halves have to agree end to end.
	it('takes back out a run that POST /api/runs had just put in', async () => {
		const id = await createRun();

		const res = await SELF.fetch(`https://training-app.test/api/runs/${id}`, { method: 'DELETE' });
		expect(res.status).toBe(200);

		expect((await SELF.fetch(`https://training-app.test/api/sessions/${id}`)).status).toBe(404);
	});

	// Deleting a generated session would leave the week short, and
	// validateSessionCount would then reject the export's own output on import.
	// Only the runs added by hand can be taken back out by hand.
	it('409s on a session the generator planned, and the session survives', async () => {
		const sessionId = await insertSession({ date: '2026-08-12', kind: 'run', label: 'Easy run', origin: 'planned' });
		await insertPlannedRun(sessionId, { run_type: 'easy', target_minutes: 30 });

		const res = await SELF.fetch(`https://training-app.test/api/runs/${sessionId}`, { method: 'DELETE' });
		expect(res.status).toBe(409);

		const detail = await fetchDetail(sessionId);
		expect(detail.session.label).toBe('Easy run');
		expect(detail.plannedRun).not.toBeNull();
	});

	// Both halves of "kind = run AND origin = manual" have to be checked: a lift
	// carries planned_sets and logged_sets this route knows nothing about, so
	// origin alone is not enough of a licence to delete one.
	it.each([
		['planned', 'planned' as const],
		['manual', 'manual' as const],
	])('409s on a %s lift session, and the session survives', async (_name, origin) => {
		const sessionId = await insertSession({ kind: 'lift', label: 'Lift A', origin });

		const res = await SELF.fetch(`https://training-app.test/api/runs/${sessionId}`, { method: 'DELETE' });
		expect(res.status).toBe(409);

		const detail = await fetchDetail(sessionId);
		expect(detail.session.label).toBe('Lift A');
	});

	it('404s for a session that does not exist', async () => {
		const res = await SELF.fetch('https://training-app.test/api/runs/999', { method: 'DELETE' });
		expect(res.status).toBe(404);
	});

	it('leaves neighbouring sessions untouched', async () => {
		const keeperId = await insertSession({ date: '2026-08-11', kind: 'run', label: 'Easy run' });
		await insertPlannedRun(keeperId, { run_type: 'easy', target_minutes: 30 });
		const id = await insertManualRun('2026-08-12');

		await SELF.fetch(`https://training-app.test/api/runs/${id}`, { method: 'DELETE' });

		const detail = await fetchDetail(keeperId);
		expect(detail.session.label).toBe('Easy run');
		expect(await countRows('planned_runs', keeperId)).toBe(1);
	});
});
