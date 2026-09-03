CREATE TABLE "fleet_actual_fleets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"source_fleet_id" uuid,
	"digger_code" text NOT NULL,
	"work_area" text NOT NULL,
	"bus_code" text
);
--> statement-breakpoint
ALTER TABLE "fleet_actual_slots" ADD COLUMN "board_fleet_id" uuid;--> statement-breakpoint
ALTER TABLE "fleet_actual_fleets" ADD CONSTRAINT "fleet_actual_fleets_document_id_fleet_actual_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fleet_actual_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_actual_fleets" ADD CONSTRAINT "fleet_actual_fleets_source_fleet_id_fleets_id_fk" FOREIGN KEY ("source_fleet_id") REFERENCES "public"."fleets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_actual_fleets_document_digger_idx" ON "fleet_actual_fleets" USING btree ("document_id","digger_code");--> statement-breakpoint
CREATE INDEX "fleet_actual_fleets_document_id_idx" ON "fleet_actual_fleets" USING btree ("document_id");--> statement-breakpoint
ALTER TABLE "fleet_actual_slots" ADD CONSTRAINT "fleet_actual_slots_board_fleet_id_fleet_actual_fleets_id_fk" FOREIGN KEY ("board_fleet_id") REFERENCES "public"."fleet_actual_fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill, written by hand.
--
-- Boards built before this migration never recorded their formations, so most
-- of that history is simply gone and is left gone: `board_fleet_id` stays null
-- and those boards read as "no fleet", which is true, rather than borrowing
-- today's Fleet Setting, which is what the bug did.
--
-- The one case worth recovering is a board whose formation still exists *and*
-- was created before the board was generated. There the live row is the same
-- row the board was built from, so copying it now records what was actually
-- true that shift. A formation created afterwards cannot have been — that is
-- precisely the digger-reuse case that relabelled old boards with a work area
-- from days later — so `created_at <= generated_at` is the gate.
--
-- The heuristic is not airtight: a formation created before the board and
-- edited since is copied in its edited state, because `fleets` keeps no record
-- of when it was last changed. Accepted knowingly — it is bounded to boards
-- whose formation survived, and from here on every new board carries its own
-- copy and needs no guessing at all.
INSERT INTO "fleet_actual_fleets" ("document_id", "source_fleet_id", "digger_code", "work_area", "bus_code")
SELECT DISTINCT ON (d."id", dg."code")
       d."id", f."id", dg."code", f."work_area", bus."code"
  FROM "fleet_actual_documents" d
  JOIN "fleet_actual_slots" s ON s."document_id" = d."id"
  LEFT JOIN "fleet_units" fu ON fu."unit_id" = s."unit_id"
  JOIN "fleets" f ON f."digger_unit_id" = s."unit_id" OR f."id" = fu."fleet_id"
  JOIN "units" dg ON dg."id" = f."digger_unit_id"
  LEFT JOIN "units" bus ON bus."id" = f."bus_unit_id"
 WHERE f."created_at" <= d."generated_at"
 ORDER BY d."id", dg."code";
--> statement-breakpoint
UPDATE "fleet_actual_slots" s
   SET "board_fleet_id" = baf."id"
  FROM "fleet_actual_fleets" baf
  JOIN "fleets" f ON f."id" = baf."source_fleet_id"
 WHERE baf."document_id" = s."document_id"
   AND (
     f."digger_unit_id" = s."unit_id"
     OR EXISTS (
       SELECT 1 FROM "fleet_units" fu
        WHERE fu."unit_id" = s."unit_id" AND fu."fleet_id" = f."id"
     )
   );
