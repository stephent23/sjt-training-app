import { Hono } from 'hono';
import { generateNextWeek, importProposal, insertWeekFromProposal } from '../generator';
import type { WeekProposal, WeekProposalInput } from '../types';

export const generator = new Hono<{ Bindings: Env }>();

interface GeneratedPlanRow {
	id: number;
	created_at: string;
	status: 'pending' | 'accepted' | 'rejected';
	week_number: number;
	plan_json: string;
	deterministic_json: string;
	source: string;
	reviewed_at: string | null;
}

// This is what step 1's download link fetches — the full deterministic pass
// plus everything a human (or whatever AI assistant they paste it into)
// needs to review it.
generator.get('/export', async (c) => {
	const context = await generateNextWeek(c.env.DB);
	return c.json(context);
});

// Body is a WeekProposalInput — validates, hydrates, persists as pending.
// 422s with the validation errors on a bad proposal, same as a live-API
// response would have gotten (see plan risk #6); also 422s if a plan is
// already pending.
generator.post('/import', async (c) => {
	const body = await c.req.json<WeekProposalInput>();
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
			week_number: row.week_number,
			created_at: row.created_at,
			plan: JSON.parse(row.plan_json) as WeekProposal,
		},
	});
});

generator.post('/:id/accept', async (c) => {
	const id = Number(c.req.param('id'));
	const row = await c.env.DB.prepare(`SELECT * FROM generated_plans WHERE id = ? AND status = 'pending'`).bind(id).first<GeneratedPlanRow>();
	if (!row) return c.json({ error: 'not found' }, 404);

	const plan = JSON.parse(row.plan_json) as WeekProposal;
	await insertWeekFromProposal(c.env.DB, plan);

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
