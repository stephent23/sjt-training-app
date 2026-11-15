-- Migration number: 0012 	 2026-11-15T21:00:00.000Z

-- Three numbers a Garmin watch already knows about the runner, typed in on the
-- Goals screen and refreshed now and then. They are about the athlete, not
-- about one run, which is why they live on settings rather than logged_runs.
--
-- vo2max is the best single figure for judging whether a race target is
-- realistic; lactate threshold pace and heart rate set tempo work directly.
-- All optional, and never guessed when missing.
ALTER TABLE settings ADD COLUMN vo2max REAL;
ALTER TABLE settings ADD COLUMN threshold_pace_seconds_per_km INTEGER;
ALTER TABLE settings ADD COLUMN threshold_hr INTEGER;
