CREATE TYPE "public"."ticket_status" AS ENUM('printed', 'failed', 'dry');--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nik" text NOT NULL,
	"date" date NOT NULL,
	"shift" "shift_kind" NOT NULL,
	"ip" text NOT NULL,
	"printer_id" uuid,
	"status" "ticket_status" NOT NULL,
	"content_hash" text NOT NULL,
	"preview" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"printed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_printer_id_printers_id_fk" FOREIGN KEY ("printer_id") REFERENCES "public"."printers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_person_content_idx" ON "tickets" USING btree ("nik","date","shift","content_hash");--> statement-breakpoint
CREATE INDEX "tickets_date_shift_idx" ON "tickets" USING btree ("date","shift");