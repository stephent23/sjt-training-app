-- Migration number: 0009 	 2026-08-29T09:00:00.000Z

-- Garmin's post-run summary for an interval or tempo session gives two paces:
-- the overall run pace (already derived from distance_km/duration_seconds —
-- never stored, see the comment on LoggedRunEntry) and a separate "interval
-- pace", the average pace during just the work segments. That one can't be
-- derived the same way: the interval-level distance/duration aren't captured
-- anywhere (per-lap splits were deliberately dropped — see roadmap stage 11,
-- "most typing, least signal"), so unlike overall pace it has to be a real
-- stored value, copied off the watch by hand like every other optional metric.
--
-- Nullable and unbounded by the schema (bounds are enforced in the route, same
-- as every other watch metric — see src/types.ts's INTERVAL_PACE_BOUNDS) —
-- only meaningful for 'intervals'/'tempo' runs, but nothing stops it being set
-- regardless of run_type, matching how none of the other optional metrics are
-- restricted by run_type either.
ALTER TABLE logged_runs ADD COLUMN interval_pace_seconds_per_km INTEGER;
