-- Migration number: 0005 	 2026-08-04T00:00:00.000Z

-- generated_plans now holds a MULTI-week proposal (plan_json/deterministic_json
-- shift from a single WeekProposal to { weeks: WeekProposal[] }). week_number
-- becomes first_week_number, plus a week_count so a pending/accepted row can
-- be described without re-parsing the JSON blob.
ALTER TABLE generated_plans RENAME COLUMN week_number TO first_week_number;
ALTER TABLE generated_plans ADD COLUMN week_count INTEGER NOT NULL DEFAULT 1;
