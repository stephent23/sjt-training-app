import { Hono } from 'hono';
import { generateNextWeeks, importProposal, insertWeeksFromProposal } from '../generator';
import type { MultiWeekProposal, MultiWeekProposalInput } from '../types';

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
	const context = await generateNextWeeks(c.env.DB, weeks);
	return c.json(context);
});

// Body is a MultiWeekProposalInput — validates, hydrates, persists as
// pending. 422s with the validation errors on a bad proposal, same as a
// live-API response would have gotten (see plan risk #6); also 422s if a
// plan is already pending.
generator.post('/import', async (c) => {
	const body = await c.req.json<MultiWeekProposalInput>();
	const result = await importProposal(c.env.DB, body);
	if (!result.ok) return c.json({ error: result.errors.join('; ') }, 422);
	return c.json({ id: result.id });
});

generator.get('/pending', async (c) => {
	const row = await c.env.DB.prepare(`SELECT * FROM generated_plans WHERE status = 'pending' ORDER BY id DESC LIMIT 1`).first<GeneratedPlanRow>();
	if (!row) return c.json({ pending: null });

	return c.json({
		pending: {
			id: row.id,
			first_week_number: row.first_week_number,
			week_count: row.week_count,
			created_at: row.created_at,
			plan: JSON.parse(row.plan_json) as MultiWeekProposal,
		},
	});
});

generator.post('/:id/accept', async (c) => {
	const id = Number(c.req.param('id'));
	const row = await c.env.DB.prepare(`SELECT * FROM generated_plans WHERE id = ? AND status = 'pending'`).bind(id).first<GeneratedPlanRow>();
	if (!row) return c.json({ error: 'not found' }, 404);

	const plan = JSON.parse(row.plan_json) as MultiWeekProposal;
	await insertWeeksFromProposal(c.env.DB, plan);

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
