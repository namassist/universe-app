CREATE TYPE "public"."plan_history_action" AS ENUM('assigned', 'released');--> statement-breakpoint
CREATE TYPE "public"."plan_history_source" AS ENUM('board', 'import', 'migration');--> statement-breakpoint
CREATE TABLE "fleet_plan_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"employee_id" uuid,
	"nik" text NOT NULL,
	"name" text NOT NULL,
	"action" "plan_history_action" NOT NULL,
	"source" "plan_history_source" NOT NULL,
	"actor_user_id" uuid,
	"actor_name" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fleet_plan_history" ADD CONSTRAINT "fleet_plan_history_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_plan_history" ADD CONSTRAINT "fleet_plan_history_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_plan_history" ADD CONSTRAINT "fleet_plan_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_plan_history_unit_created_idx" ON "fleet_plan_history" USING btree ("unit_id","created_at");--> statement-breakpoint
-- The pairings that stand today are where every unit's history begins: when
-- they were made is known, who made them is not.
INSERT INTO "fleet_plan_history" ("unit_id", "employee_id", "nik", "name", "action", "source", "created_at")
SELECT s."unit_id", s."employee_id", e."nik", e."name", 'assigned', 'migration', s."created_at"
FROM "fleet_plan_slots" s
JOIN "employees" e ON e."id" = s."employee_id";
