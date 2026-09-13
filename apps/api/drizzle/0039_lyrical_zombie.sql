CREATE TABLE "device_live_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"nik" text NOT NULL,
	"at" timestamp NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "device_live_events_ip_nik_at_idx" ON "device_live_events" USING btree ("ip","nik","at");--> statement-breakpoint
CREATE INDEX "device_live_events_at_idx" ON "device_live_events" USING btree ("at");