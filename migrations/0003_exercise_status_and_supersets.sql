-- Migration number: 0003 	 2026-08-03T00:00:00.000Z

-- Per-exercise skip, mirroring the existing sessions.status convention.
ALTER TABLE planned_sets ADD COLUMN status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'skipped'));

-- Superset pairing: a flat nullable group tag, not a parent/child table —
-- same philosophy as structure_json's flat interval-step list ("nesting is
-- where running-plan schemas go to die"). Rows sharing a non-null value
-- within one session are paired. No FK: an annotation, not a relationship.
ALTER TABLE planned_sets ADD COLUMN superset_group INTEGER;
