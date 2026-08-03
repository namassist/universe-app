CREATE TABLE "fleet_plan_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_plan_slots_employee_id_unique" UNIQUE("employee_id")
);
--> statement-breakpoint
ALTER TABLE "fleet_plan_slots" ADD CONSTRAINT "fleet_plan_slots_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_plan_slots" ADD CONSTRAINT "fleet_plan_slots_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_plan_slots_unit_employee_idx" ON "fleet_plan_slots" USING btree ("unit_id","employee_id");--> statement-breakpoint
CREATE INDEX "fleet_plan_slots_unit_id_idx" ON "fleet_plan_slots" USING btree ("unit_id");