ALTER TYPE "public"."notification_kind" ADD VALUE 'device-log-sizes';--> statement-breakpoint
CREATE TABLE "derived_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nik" text NOT NULL,
	"date" date NOT NULL,
	"first_in_at" timestamp,
	"first_in_ip" text,
	"first_in_pm_at" timestamp,
	"first_in_pm_ip" text,
	"first_out_at" timestamp,
	"first_out_ip" text,
	"derived_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "derived_readings_nik_date_unique" ON "derived_readings" USING btree ("nik","date");--> statement-breakpoint
CREATE INDEX "derived_readings_date_idx" ON "derived_readings" USING btree ("date");