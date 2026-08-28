-- Migration number: 0008 	 2026-08-23T09:00:00.000Z

-- Sessions could only ever enter the database one way: the generator's
-- import/accept path. A run you actually went out and did, that was never in
-- the plan, had nowhere to live at all.
--
-- `origin` is what keeps such a run from poisoning the next plan. The export
-- builds week 1 by copying the anchor week's sessions forward, and
-- validateSessionCount requires week 1 to hold exactly days_per_week sessions
-- — so an extra session in that week would make the export's own output
-- un-importable, and would then be copied forward into every future week
-- forever. A manual run is a record of what happened, not a template: the
-- copy-forward loop skips it. It still reaches the assistant, because
-- historyWindow.loggedRuns is selected across the whole window rather than
-- from the copy list.
--
-- Defaulting to 'planned' leaves every existing row, and every generator
-- insert, exactly as it was.
ALTER TABLE sessions ADD COLUMN origin TEXT NOT NULL DEFAULT 'planned' CHECK (origin IN ('planned', 'manual'));

-- logged_runs got its one-row-per-session guarantee in migration 0002; on
-- planned_runs the same rule has only ever been a convention that the code
-- comments assert and nothing enforces. Editing a run upserts the run_type on
-- ON CONFLICT (session_id), which needs the index to exist. The generator has
-- always inserted exactly one row per run session, so there is nothing to
-- de-duplicate first.
CREATE UNIQUE INDEX idx_planned_runs_unique ON planned_runs (session_id);
