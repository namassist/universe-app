CREATE TABLE "fleet_spare_transports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transport_unit_id" uuid NOT NULL,
	"work_area" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleet_actual_documents" ADD COLUMN "spare_area" text;--> statement-breakpoint
ALTER TABLE "fleet_actual_documents" ADD COLUMN "spare_bus_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "fleet_spare_transports" ADD CONSTRAINT "fleet_spare_transports_transport_unit_id_units_id_fk" FOREIGN KEY ("transport_unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;