CREATE TYPE "public"."tap_direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TABLE "device_taps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"nik" text NOT NULL,
	"at" timestamp NOT NULL,
	"direction" "tap_direction" NOT NULL,
	"verified" integer DEFAULT 0 NOT NULL,
	"pulled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "operator_booth" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "com_key" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "port" integer DEFAULT 80 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "device_taps_unique" ON "device_taps" USING btree ("ip","nik","at");--> statement-breakpoint
CREATE INDEX "device_taps_at_idx" ON "device_taps" USING btree ("at");--> statement-breakpoint
CREATE INDEX "device_taps_nik_idx" ON "device_taps" USING btree ("nik");