CREATE TYPE "public"."actual_slot_source" AS ENUM('plan', 'spare', 'manual');--> statement-breakpoint
CREATE TABLE "fleet_actual_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"shift" "shift_kind" NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_actual_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"employee_id" uuid,
	"source" "actual_slot_source",
	"tapped_at" time
);
--> statement-breakpoint
ALTER TABLE "fleet_actual_slots" ADD CONSTRAINT "fleet_actual_slots_document_id_fleet_actual_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fleet_actual_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_actual_slots" ADD CONSTRAINT "fleet_actual_slots_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_actual_slots" ADD CONSTRAINT "fleet_actual_slots_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_actual_documents_date_shift_idx" ON "fleet_actual_documents" USING btree ("date","shift");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_actual_slots_document_unit_idx" ON "fleet_actual_slots" USING btree ("document_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_actual_slots_document_employee_idx" ON "fleet_actual_slots" USING btree ("document_id","employee_id") WHERE "fleet_actual_slots"."employee_id" is not null;--> statement-breakpoint
CREATE INDEX "fleet_actual_slots_document_id_idx" ON "fleet_actual_slots" USING btree ("document_id");