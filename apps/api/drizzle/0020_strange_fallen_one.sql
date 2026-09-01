-- The no-fleet entry is derived now, not stored: every active unit that leads
-- no fleet and hauls for none is in it, computed on read. A stored list of
-- "everything else" went stale the moment a formation was reshuffled, and did
-- so silently — nothing about a stale row looks wrong.
--
-- Verified empty before this was written (0 rows on 2026-08-31), so CASCADE
-- drops constraints rather than data.
DROP TABLE "no_fleet_units" CASCADE;