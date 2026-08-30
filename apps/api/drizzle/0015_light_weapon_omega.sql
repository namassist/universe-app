CREATE TABLE "device_fleets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"fleet_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "rotate_seconds" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "device_fleets" ADD CONSTRAINT "device_fleets_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_fleets" ADD CONSTRAINT "device_fleets_fleet_id_fleets_id_fk" FOREIGN KEY ("fleet_id") REFERENCES "public"."fleets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "device_fleets_device_id_idx" ON "device_fleets" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "device_fleets_device_fleet_idx" ON "device_fleets" USING btree ("device_id","fleet_id");