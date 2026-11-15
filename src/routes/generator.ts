import { Hono } from 'hono';
import { isMondayIso, todayIso, weekStartOnOrAfter } from '../dates';
import { describeAcceptOutcome, generateNextWeeks, importProposal, insertWeeksFromProposal, type ExportPayload } from '../generator';
import { buildRaceContext } from '../raceContext';
import { buildTrainingSummary } from '../trainingSummary';
import { ATHLETE_FIELDS, type Athlete, type MultiWeekProposal, type MultiWeekProposalInput, type Race } from '../types';

const ATHLETE_KEYS = ATHLETE_FIELDS.map((f) => f.key);

export const generator = new Hono<{ Bindings: Env }>();

interface GeneratedPlanRow {
	id: number;
	created_at: string;
	status: 'pending' | 'accepted' | 'rejected';
	first_week_number: number;
	week_count: number;
	plan_json: string;
	deterministic_json: string;
	source: string;
	reviewed_at: string | null;
}

const MAX_WEEKS = 12;

// This is what step 1's download link fetches — the full deterministic pass
// plus everything a human (or whatever AI assistant they paste it into)
// needs to review it. `weeks` is clamped to a sane 1-12 range (see
// migrations/0005_generator_multiweek.sql / plan §1 for why 12) — an
// invalid or out-of-range value silently falls back to 1 rather than
// erroring (e.g. ?weeks=50 clamps to 1), matching the plan's spec exactly.
generator.get('/export', async (c) => {
	const weeksParam = Number(c.req.query('weeks') ?? '1');
	const weeks = Number.isInteger(weeksParam) && weeksParam >= 1 && weeksParam <= MAX_WEEKS ? weeksParam : 1;

	// The clock lives here, not in buildExportContext — see ExportPayload's doc
	// comment. startDate is where week 1 of the new plan (block) lands: optional,
	// but if given it must be a real Monday that is today or later. Unlike
	// `weeks` it is rejected rather than silently corrected — quietly moving a
	// plan to a different week than the one asked for would be worse than an error.
	const today = todayIso();
	const startParam = c.req.query('startDate');
	if (startParam !== undefined && !isMondayIso(startParam)) {
		return c.json({ error: 'startDate must be a Monday, as YYYY-MM-DD' }, 400);
	}
	if (startParam !== undefined && startParam < today) {
		return c.json({ error: 'startDate must be today or later' }, 400);
	}
	const startDate = startParam ?? weekStartOnOrAfter(today);

	const [context, trainingSummary, raceRows, hr] = await Promise.all([
		generateNextWeeks(c.env.DB, weeks, today, startDate),
		buildTrainingSummary(c.env.DB, today),
		c.env.DB.prepare(`SELECT id, name, date, distance_km, target_seconds, result_seconds, priority FROM races`).all<Race>(),
		c.env.DB.prepare(`SELECT ${ATHLETE_KEYS.join(', ')} FROM settings WHERE id = 1`).first<Athlete>(),
	]);
	const payload: ExportPayload = {
		...context,
		...buildRaceContext(raceRows.results, today, { startDate, weeks }),
		athlete: Object.fromEntries(ATHLETE_KEYS.map((key) => [key, hr?.[key] ?? null])) as Athlete,
		today,
		weekStartDate: startDate,
		trainingSummary,
	};
	return c.json(payload);
});

// Body is a MultiWeekProposalInput — validates, hydrates, persists as
// pending. 422s with the validation errors on a bad proposal, same as a
// live-API response would have gotten (see plan risk #6); also 422s if a
// plan is already pending.
generator.post('/import', async (c) => {
	const body = await c.req.json<MultiWeekProposalInput>();
	const source = c.req.query('source') === 'live-api' || c.req.header('X-Source') === 'live-api' ? 'live-api' : 'external-import';
	const result = await importProposal(c.env.DB, body, todayIso(), c.req.query('replace') === 'true', source);
	// `errors` is the list; `error` is the same thing joined, kept because it is
	// what every existing caller reads. The list is what lets the UI show one
	// line per problem, and hand them all back to the assistant that caused them.
	if (!result.ok) return c.json({ error: result.errors.join('; '), errors: result.errors }, 422);
	return c.json({ id: result.id });
});

generator.get('/pending', async (c) => {
	const row = await c.env.DB.prepare(`SELECT * FROM generated_plans WHERE status = 'pending' ORDER BY id DESC LIMIT 1`).first<GeneratedPlanRow>();
	if (!row) return c.json({ pending: null });

	const plan = JSON.parse(row.plan_json) as MultiWeekProposal;
	return c.json({
		pending: {
			id: row.id,
			first_week_number: row.first_week_number,
			week_count: row.week_count,
			created_at: row.created_at,
			plan,
			// What the mechanical pass proposed (so the review can show what the
			// assistant changed), and what accepting would replace.
			deterministic: JSON.parse(row.deterministic_json) as MultiWeekProposalInput,
			...(await describeAcceptOutcome(c.env.DB, plan)),
		},
	});
});

generator.post('/:id/accept', async (c) => {
	const id = Number(c.req.param('id'));
	const row = await c.env.DB.prepare(`SELECT * FROM generated_plans WHERE id = ? AND status = 'pending'`).bind(id).first<GeneratedPlanRow>();
	if (!row) return c.json({ error: 'not found' }, 404);

	const plan = JSON.parse(row.plan_json) as MultiWeekProposal;
	const result = await insertWeeksFromProposal(c.env.DB, plan, id);
	if (!result.ok) return c.json({ error: result.errors.join('; '), errors: result.errors }, 409);

	await c.env.DB.prepare(`UPDATE generated_plans SET status = 'accepted', reviewed_at = datetime('now') WHERE id = ?`).bind(id).run();

	return c.json({ ok: true });
});

generator.post('/:id/reject', async (c) => {
	const id = Number(c.req.param('id'));
	const row = await c.env.DB.prepare(`SELECT id FROM generated_plans WHERE id = ? AND status = 'pending'`).bind(id).first<{ id: number }>();
	if (!row) return c.json({ error: 'not found' }, 404);

	await c.env.DB.prepare(`UPDATE generated_plans SET status = 'rejected', reviewed_at = datetime('now') WHERE id = ?`).bind(id).run();

	return c.json({ ok: true });
});
