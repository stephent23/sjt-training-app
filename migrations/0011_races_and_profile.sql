-- Migration number: 0011 	 2026-11-15T19:00:00.000Z

-- Races: what the running is aimed at, and what has already been run.
--
-- One table for both directions in time, because they are the same fact at
-- different moments: a future row is a goal (date, distance, optional target
-- time), and once the day has passed the same row takes a result. A past race
-- or time trial can also be added straight in with its result. Personal bests
-- are therefore derived — the fastest result per distance — rather than kept
-- as a second list that could disagree with this one.
--
-- priority: 'A' is a race the plan should peak and taper for; 'B' is run as
-- part of training. Seconds, not a formatted string, so pace maths needs no parsing.
CREATE TABLE races (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  date           TEXT NOT NULL,
  distance_km    REAL NOT NULL CHECK (distance_km > 0),
  target_seconds INTEGER CHECK (target_seconds IS NULL OR target_seconds > 0),
  result_seconds INTEGER CHECK (result_seconds IS NULL OR result_seconds > 0),
  priority       TEXT NOT NULL DEFAULT 'A' CHECK (priority IN ('A', 'B')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_races_date ON races (date);

-- Heart-rate anchors. Without a max, a logged average of 152 bpm says nothing
-- about how hard a run was; with one, the assistant can read every logged run
-- as a share of max and set effort zones. Both optional — never guessed.
ALTER TABLE settings ADD COLUMN max_hr INTEGER;
ALTER TABLE settings ADD COLUMN resting_hr INTEGER;
