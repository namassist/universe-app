ALTER TABLE "fingerprint_machines" ADD COLUMN "online" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "status_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "miss_count" integer DEFAULT 0 NOT NULL;