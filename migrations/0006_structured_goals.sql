-- Migration number: 0006 	 2026-08-09T22:40:00.000Z

-- Free-text goals are easy to leave vague ("get fitter"), and vague goals are
-- exactly what the AI reviewer can't act on — it has no way to tell whether
-- "get fitter" means add squat weight or drop long-run pace. A fixed tag
-- vocabulary gives the prompt something it can state the meaning of.
--
-- Stored as a JSON array of slugs in one column rather than a join table: it is
-- a handful of flags on a single-row settings table that are always read and
-- written whole, and the app already keeps flat JSON in TEXT for the same
-- reason elsewhere (planned_runs.structure_json, generated_plans.plan_json).
-- The route validates every slug against the list in src/types.ts, so a CHECK
-- constraint here would only duplicate that in a place that can't give a
-- useful error.
ALTER TABLE settings ADD COLUMN goal_tags TEXT NOT NULL DEFAULT '[]';
