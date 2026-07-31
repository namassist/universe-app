CREATE TABLE "fleet_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fleet_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	CONSTRAINT "fleet_units_unit_id_unique" UNIQUE("unit_id")
);
--> statement-breakpoint
CREATE TABLE "fleets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"digger_unit_id" uuid NOT NULL,
	"work_area_id" uuid NOT NULL,
	"bus_unit_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleets_digger_unit_id_unique" UNIQUE("digger_unit_id")
);
--> statement-breakpoint
ALTER TABLE "fleet_units" ADD CONSTRAINT "fleet_units_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_units" ADD CONSTRAINT "fleet_units_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_digger_unit_id_units_id_fk" FOREIGN KEY ("digger_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_work_area_id_work_areas_id_fk" FOREIGN KEY ("work_area_id") REFERENCES "public"."work_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleets" ADD CONSTRAINT "fleets_bus_unit_id_units_id_fk" FOREIGN KEY ("bus_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_units_fleet_id_idx" ON "fleet_units" USING btree ("fleet_id");