ALTER TYPE "public"."timeline_action" ADD VALUE 'ftw-ingest' BEFORE 'finger-in';--> statement-breakpoint
CREATE TABLE "finger_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nik" text NOT NULL,
	"date" date NOT NULL,
	"first_in_at" timestamp,
	"first_in_ip" text,
	"first_out_at" timestamp,
	"first_out_ip" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ftw_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nik" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"company" text,
	"department" text,
	"position" text,
	"mess" text,
	"shift" text,
	"sleep_minutes" integer DEFAULT 0 NOT NULL,
	"sleep_category" text,
	"ftw_decision" text,
	"sent_at" timestamp,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "finger_readings_nik_date_idx" ON "finger_readings" USING btree ("nik","date");--> statement-breakpoint
CREATE INDEX "finger_readings_date_idx" ON "finger_readings" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "ftw_readings_nik_date_idx" ON "ftw_readings" USING btree ("nik","date");--> statement-breakpoint
CREATE INDEX "ftw_readings_date_idx" ON "ftw_readings" USING btree ("date");