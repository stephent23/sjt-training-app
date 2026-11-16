-- Migration number: 0014 	 2026-11-16T12:00:00.000Z

-- Plan blocks may not overlap in dates. Older accepts left an earlier block's
-- row (and its later untouched sessions) sitting under a newer block. For every
-- block that overlaps a LATER block, drop its untouched planned sessions dated
-- on/after that later block's start (untouched = still 'planned' with nothing
-- logged, as in findReplaceableSessions), trim week_count to what remains, and
-- delete the block if nothing remains. Trained sessions are never deleted.
-- Idempotent, and a no-op on data with no overlaps.

DROP TABLE IF EXISTS _tidy_cut;
CREATE TABLE _tidy_cut (block_id INTEGER PRIMARY KEY, cutoff TEXT NOT NULL);

-- cutoff = start of the earliest later block that begins inside this block's range.
-- A block's end is the later of its stored range and its last session: the stored
-- week_count came from the old global week numbers (migration 0010) and cannot
-- be trusted to be the real extent in either direction.
INSERT INTO _tidy_cut (block_id, cutoff)
SELECT b.id,
       (SELECT MIN(l.start_date) FROM plan_blocks l
        WHERE l.start_date > b.start_date
          AND l.start_date <= max(date(b.start_date, '+' || (b.week_count * 7 - 1) || ' days'),
                                  COALESCE((SELECT MAX(date) FROM sessions WHERE block_id = b.id), b.start_date)))
FROM plan_blocks b
WHERE EXISTS (SELECT 1 FROM plan_blocks l
              WHERE l.start_date > b.start_date
                AND l.start_date <= max(date(b.start_date, '+' || (b.week_count * 7 - 1) || ' days'),
                                        COALESCE((SELECT MAX(date) FROM sessions WHERE block_id = b.id), b.start_date)));

DROP TABLE IF EXISTS _tidy_ids;
CREATE TABLE _tidy_ids (id INTEGER PRIMARY KEY);
INSERT INTO _tidy_ids (id)
SELECT s.id FROM sessions s JOIN _tidy_cut c ON c.block_id = s.block_id
WHERE s.date >= c.cutoff AND s.status = 'planned'
  AND NOT EXISTS (SELECT 1 FROM logged_sets ls WHERE ls.session_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM logged_runs lr WHERE lr.session_id = s.id);

-- Children first, exactly as src/sessionDelete.ts orders them.
DELETE FROM exercise_swaps WHERE session_id IN (SELECT id FROM _tidy_ids);
DELETE FROM logged_sets WHERE session_id IN (SELECT id FROM _tidy_ids);
DELETE FROM planned_sets WHERE session_id IN (SELECT id FROM _tidy_ids);
DELETE FROM session_feedback WHERE session_id IN (SELECT id FROM _tidy_ids);
DELETE FROM logged_runs WHERE session_id IN (SELECT id FROM _tidy_ids);
DELETE FROM planned_runs WHERE session_id IN (SELECT id FROM _tidy_ids);
DELETE FROM sessions WHERE id IN (SELECT id FROM _tidy_ids);

-- Trim from what actually remains (the stored week_count may overstate).
UPDATE plan_blocks
SET week_count = (SELECT MAX(week_number) FROM sessions WHERE block_id = plan_blocks.id)
WHERE id IN (SELECT block_id FROM _tidy_cut)
  AND EXISTS (SELECT 1 FROM sessions WHERE block_id = plan_blocks.id);

-- A block with nothing left goes, after detaching plans that point at it.
UPDATE generated_plans SET block_id = NULL
WHERE block_id IN (SELECT block_id FROM _tidy_cut)
  AND NOT EXISTS (SELECT 1 FROM sessions WHERE block_id = generated_plans.block_id);

DELETE FROM plan_blocks
WHERE id IN (SELECT block_id FROM _tidy_cut)
  AND NOT EXISTS (SELECT 1 FROM sessions WHERE block_id = plan_blocks.id);

DROP TABLE _tidy_ids;
DROP TABLE _tidy_cut;
