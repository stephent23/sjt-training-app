-- Migration number: 0002 	 2026-08-03T09:15:00.000Z

-- Logging is local-first: the client writes to localStorage immediately and
-- retries the sync fetch on failure. A retried request must not double-log a
-- set or run, so upserts need something to conflict on.

CREATE UNIQUE INDEX idx_logged_sets_unique ON logged_sets (session_id, exercise_id, set_index);
CREATE UNIQUE INDEX idx_logged_runs_unique ON logged_runs (session_id);
