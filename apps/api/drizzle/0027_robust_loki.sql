ALTER TABLE "fleet_actual_slots" ADD COLUMN "work_area" text;--> statement-breakpoint
-- Boards already generated carry their formations' area but not their units'.
-- For a formation the two are the same value, so copying it down is exact; the
-- support group has none, and those units' whereabouts that shift were never
-- recorded and cannot be recovered.
UPDATE "fleet_actual_slots" s
   SET "work_area" = baf."work_area"
  FROM "fleet_actual_fleets" baf
 WHERE baf."id" = s."board_fleet_id" AND baf."work_area" IS NOT NULL;
