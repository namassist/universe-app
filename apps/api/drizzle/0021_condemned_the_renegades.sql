ALTER TABLE "fleets" ADD COLUMN "work_area" text;
--> statement-breakpoint
-- Carry every fleet's location over as text before the reference goes.
-- Without this the next migration would drop the only copy of it.
UPDATE "fleets" f
   SET "work_area" = w."name"
  FROM "work_areas" w
 WHERE w."id" = f."work_area_id";
