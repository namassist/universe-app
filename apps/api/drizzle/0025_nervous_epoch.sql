CREATE TYPE "public"."board_group_kind" AS ENUM('fleet', 'support');--> statement-breakpoint
ALTER TABLE "fleets" DROP CONSTRAINT "fleets_digger_unit_id_unique";--> statement-breakpoint
ALTER TABLE "fleet_actual_fleets" ALTER COLUMN "digger_code" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_actual_fleets" ALTER COLUMN "work_area" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleets" ALTER COLUMN "digger_unit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleets" ALTER COLUMN "work_area" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_actual_fleets" ADD COLUMN "kind" "board_group_kind" DEFAULT 'fleet' NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_actual_fleets" ADD COLUMN "leader_code" text;--> statement-breakpoint
ALTER TABLE "fleet_actual_slots" ADD COLUMN "transport_code" text;--> statement-breakpoint
ALTER TABLE "fleets" ADD COLUMN "leader_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "work_area" text;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "transport_unit_id" uuid;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "fleet_support" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_leader_unit_id_units_id_fk" FOREIGN KEY ("leader_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_transport_unit_id_units_id_fk" FOREIGN KEY ("transport_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "units_transport_unit_id_idx" ON "units" USING btree ("transport_unit_id");--> statement-breakpoint
-- Carry the data across before the old columns go in the next migration.
-- Split in two because drizzle-kit cannot generate a rename without a TTY, and
-- the split is worth having anyway: the copy is explicit and reviewable here
-- rather than implied by a rename it guessed.
UPDATE "fleets" SET "leader_unit_id" = "digger_unit_id";
--> statement-breakpoint
-- The fleet's area becomes its leader's, and every member is held to the same
-- value — which is the rule "one formation, one area", now enforced on write
-- instead of stored twice.
UPDATE "units" u SET "work_area" = f."work_area"
  FROM "fleets" f WHERE f."leader_unit_id" = u."id";
--> statement-breakpoint
UPDATE "units" u SET "work_area" = f."work_area"
  FROM "fleet_units" fu JOIN "fleets" f ON f."id" = fu."fleet_id"
 WHERE fu."unit_id" = u."id";
--> statement-breakpoint
-- The fleet's bus becomes the ride of every unit in it. Per unit from here on:
-- two units of one formation may legitimately be on different vehicles.
UPDATE "units" u SET "transport_unit_id" = f."bus_unit_id"
  FROM "fleets" f
 WHERE f."bus_unit_id" IS NOT NULL AND f."leader_unit_id" = u."id";
--> statement-breakpoint
UPDATE "units" u SET "transport_unit_id" = f."bus_unit_id"
  FROM "fleet_units" fu JOIN "fleets" f ON f."id" = fu."fleet_id"
 WHERE f."bus_unit_id" IS NOT NULL AND fu."unit_id" = u."id";
--> statement-breakpoint
-- Boards already generated keep their formations; only the column name moves.
UPDATE "fleet_actual_fleets" SET "leader_code" = "digger_code";
--> statement-breakpoint
-- Their per-fleet bus becomes the per-slot ride it now is.
UPDATE "fleet_actual_slots" s SET "transport_code" = baf."bus_code"
  FROM "fleet_actual_fleets" baf
 WHERE baf."id" = s."board_fleet_id" AND baf."bus_code" IS NOT NULL;
