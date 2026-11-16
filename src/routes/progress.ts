import { Hono } from 'hono';
import { todayIso } from '../dates';
import { buildProgress } from '../progress';
import { buildRaceContext } from '../raceContext';
import { buildTrainingSummary } from '../trainingSummary';
import type { Race } from '../types';

export const progress = new Hono<{ Bindings: Env }>();

// Read-only: the same summary and race context the export hands the plan-writer.
progress.get('/', async (c) => {
	const today = todayIso();
	const [summary, raceRows] = await Promise.all([
		buildTrainingSummary(c.env.DB, today),
		c.env.DB.prepare(`SELECT id, name, date, distance_km, target_seconds, result_seconds, priority FROM races`).all<Race>(),
	]);
	return c.json(buildProgress(summary, buildRaceContext(raceRows.results, today)));
});
