CREATE TABLE "device_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"command" text NOT NULL,
	"ok" boolean NOT NULL,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "device_requests_at_idx" ON "device_requests" USING btree ("at");