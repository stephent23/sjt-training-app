-- Migration number: 0004 	 2026-08-03T12:00:00.000Z

-- Single fixed row. Free-text goals, plus the one scheduling parameter
-- validation needs. days_per_week defaults to 5 to match the actual current
-- week (2 lifts + 3 runs) — NOT an arbitrary "4-day" default, which would
-- fail validation on the very first generation.
CREATE TABLE settings (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	goals TEXT NOT NULL DEFAULT '',
	days_per_week INTEGER NOT NULL DEFAULT 5
);
INSERT INTO settings (id, goals, days_per_week) VALUES (1, '', 5);

-- One generated week, held as a single JSON blob until reviewed — same
-- flat-JSON philosophy as structure_json. Fully separate from live data:
-- accepting a plan is a normal INSERT pass, never a status flip.
CREATE TABLE generated_plans (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	created_at TEXT NOT NULL DEFAULT (datetime('now')),
	status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
	week_number INTEGER NOT NULL,
	plan_json TEXT NOT NULL,          -- the validated WeekProposal (post-hydration)
	deterministic_json TEXT NOT NULL, -- the pre-review pass, kept for audit
	source TEXT NOT NULL DEFAULT 'external-import', -- 'external-import' now; 'live-api' once Phase 2 lands
	reviewed_at TEXT
);

CREATE INDEX idx_generated_plans_status ON generated_plans (status);
CREATE UNIQUE INDEX idx_generated_plans_one_pending ON generated_plans (status) WHERE status = 'pending';
