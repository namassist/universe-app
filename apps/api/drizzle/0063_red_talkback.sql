CREATE TYPE "public"."display_subject" AS ENUM('fleet', 'unit');--> statement-breakpoint
CREATE TABLE "device_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"unit_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "subject" "display_subject" DEFAULT 'fleet' NOT NULL;--> statement-breakpoint
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_units" ADD CONSTRAINT "device_units_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "device_units_device_unit_idx" ON "device_units" USING btree ("device_id","unit_id");--> statement-breakpoint
CREATE INDEX "device_units_unit_id_idx" ON "device_units" USING btree ("unit_id");