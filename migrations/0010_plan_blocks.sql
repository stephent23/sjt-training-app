-- Migration number: 0010 	 2026-11-15T09:00:00.000Z

-- A "block" is one generated plan, once accepted. Until now week_number was a
-- single global counter (MAX+1 on every accept), so the app was showing
-- "Week 23" with no way to say "from next week I want a new plan". Now a block
-- owns its own numbering: sessions.week_number is the week WITHIN the block
-- (1..week_count) and the UI reads "Block 3 · Week 1 of 8".
--
-- goals / goal_tags are a snapshot of what the settings said when the block was
-- accepted, so a later look at an old block still shows what it was aimed at.
-- generated_plan_id is informational (no FK: a plan row is never deleted, but
-- nothing here should depend on that).
CREATE TABLE plan_blocks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  start_date        TEXT NOT NULL,
  week_count        INTEGER NOT NULL CHECK (week_count >= 1),
  goals             TEXT NOT NULL DEFAULT '',
  goal_tags         TEXT NOT NULL DEFAULT '[]',
  generated_plan_id INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nullable: a manual run (migration 0008) is not part of any plan, and a
-- session can outlive its block row only by being deleted with it.
ALTER TABLE sessions ADD COLUMN block_id INTEGER REFERENCES plan_blocks(id);
CREATE INDEX idx_sessions_block ON sessions (block_id);

-- Backfill: everything that exists today is one block. week_number is left
-- exactly as it is — it is already 1..N for the plans that were accepted, and
-- renumbering would only break the history. (Weeks keep their old global
-- numbers inside Block 1; new blocks start again from 1.) Skipped entirely on
-- an empty database.
INSERT INTO plan_blocks (name, start_date, week_count, goals, goal_tags)
SELECT 'Block 1',
       MIN(date),
       MAX(week_number),
       COALESCE((SELECT goals FROM settings WHERE id = 1), ''),
       COALESCE((SELECT goal_tags FROM settings WHERE id = 1), '[]')
FROM sessions
HAVING COUNT(*) > 0;

UPDATE sessions SET block_id = (SELECT id FROM plan_blocks ORDER BY id LIMIT 1)
WHERE EXISTS (SELECT 1 FROM plan_blocks);
