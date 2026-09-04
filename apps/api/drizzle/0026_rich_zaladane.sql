ALTER TABLE "fleets" DROP CONSTRAINT "fleets_digger_unit_id_units_id_fk";
--> statement-breakpoint
ALTER TABLE "fleets" DROP CONSTRAINT "fleets_bus_unit_id_units_id_fk";
--> statement-breakpoint
DROP INDEX "fleet_actual_fleets_document_digger_idx";--> statement-breakpoint
ALTER TABLE "fleets" ALTER COLUMN "leader_unit_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_actual_fleets_document_leader_idx" ON "fleet_actual_fleets" USING btree ("document_id","leader_code");--> statement-breakpoint
ALTER TABLE "fleet_actual_fleets" DROP COLUMN "digger_code";--> statement-breakpoint
ALTER TABLE "fleet_actual_fleets" DROP COLUMN "bus_code";--> statement-breakpoint
ALTER TABLE "fleets" DROP COLUMN "digger_unit_id";--> statement-breakpoint
ALTER TABLE "fleets" DROP COLUMN "work_area";--> statement-breakpoint
ALTER TABLE "fleets" DROP COLUMN "bus_unit_id";--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_leader_unit_id_unique" UNIQUE("leader_unit_id");