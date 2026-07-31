CREATE TYPE "public"."unit_status" AS ENUM('breakdown', 'standby', 'ready');--> statement-breakpoint
CREATE TABLE "unit_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"status" "unit_status" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unit_status_history" ADD CONSTRAINT "unit_status_history_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unit_status_history_unit_created_idx" ON "unit_status_history" USING btree ("unit_id","created_at");