ALTER TYPE "public"."plan_history_source" ADD VALUE 'reset';--> statement-breakpoint
CREATE TABLE "fleet_plan_default_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_name" text NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fleet_plan_defaults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"employee_id" uuid,
	"nik" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleet_plan_default_imports" ADD CONSTRAINT "fleet_plan_default_imports_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_plan_defaults" ADD CONSTRAINT "fleet_plan_defaults_import_id_fleet_plan_default_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."fleet_plan_default_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_plan_defaults" ADD CONSTRAINT "fleet_plan_defaults_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_plan_defaults" ADD CONSTRAINT "fleet_plan_defaults_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fleet_plan_defaults_employee_idx" ON "fleet_plan_defaults" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "fleet_plan_defaults_unit_id_idx" ON "fleet_plan_defaults" USING btree ("unit_id");