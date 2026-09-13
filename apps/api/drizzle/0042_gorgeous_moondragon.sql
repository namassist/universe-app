CREATE TABLE "fleet_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"employee_id" uuid,
	"placed_by" uuid,
	"placed_by_name" text NOT NULL,
	"ftw_verdict" text,
	"finger_verdict" text,
	"overrode" boolean DEFAULT false NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleet_placements" ADD CONSTRAINT "fleet_placements_document_id_fleet_actual_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fleet_actual_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_placements" ADD CONSTRAINT "fleet_placements_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_placements" ADD CONSTRAINT "fleet_placements_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_placements" ADD CONSTRAINT "fleet_placements_placed_by_users_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_placements_document_idx" ON "fleet_placements" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "fleet_placements_employee_idx" ON "fleet_placements" USING btree ("employee_id");