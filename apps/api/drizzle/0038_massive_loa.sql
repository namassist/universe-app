CREATE TABLE "printers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ip" text NOT NULL,
	"port" integer DEFAULT 9100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "printers_ip_unique" UNIQUE("ip")
);
--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "printer_id" uuid;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD COLUMN "universe_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD CONSTRAINT "fingerprint_machines_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fingerprint_machines" ADD CONSTRAINT "fingerprint_machines_printer_id_unique" UNIQUE("printer_id");