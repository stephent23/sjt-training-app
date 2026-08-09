-- Migration number: 0007 	 2026-08-09T22:55:00.000Z

-- Running was the thinnest thing the app recorded: distance, duration, one
-- heart-rate number and an RPE. That is not enough for the weekly review to
-- tell a good week from a week that quietly cost too much — an easy run at the
-- right pace and one run far too hard look identical in the data.
--
-- These four are everything a Garmin shows on the post-run summary screen, and
-- nothing that needs a device export or a file upload to obtain. All nullable:
-- every one is copied across by hand, so any of them can be skipped without
-- making the run unloggable. Ranges are validated in the route rather than by
-- CHECK constraints — the sync queue retries 5xx forever, so a bad value has to
-- come back as a 400 (see the comment on POST /:id/sets).
ALTER TABLE logged_runs ADD COLUMN max_hr INTEGER;
ALTER TABLE logged_runs ADD COLUMN avg_cadence_spm INTEGER;
ALTER TABLE logged_runs ADD COLUMN elevation_gain_m REAL;
ALTER TABLE logged_runs ADD COLUMN aerobic_training_effect REAL;
