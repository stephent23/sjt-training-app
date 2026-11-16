-- Migration number: 0013 	 2026-11-16T09:00:00.000Z

-- A pending plan can now be a REVISION of a block already in progress instead
-- of a brand-new block. block_id names the block being adjusted; NULL (every
-- existing row, and every ordinary new plan) means "create a new block".
-- Accepting an adjusting plan keeps the block, continues its week numbering,
-- and replaces only the sessions that have not been trained.
ALTER TABLE generated_plans ADD COLUMN block_id INTEGER REFERENCES plan_blocks(id);
