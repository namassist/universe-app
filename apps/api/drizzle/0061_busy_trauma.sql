CREATE TYPE "public"."point_outcome" AS ENUM('operated', 'stood-down', 'not-counted', 'not-ready', 'unreadable');--> statement-breakpoint
CREATE TABLE "operator_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"shift" "shift_kind" NOT NULL,
	"employee_id" uuid NOT NULL,
	"nik" text NOT NULL,
	"name" text NOT NULL,
	"department_id" uuid,
	"unit_type_id" uuid,
	"unit_code" text,
	"outcome" "point_outcome" NOT NULL,
	"base" integer NOT NULL,
	"on_time" integer NOT NULL,
	"sleep" integer NOT NULL,
	"streak_bonus" integer NOT NULL,
	"total" integer NOT NULL,
	"streak" integer NOT NULL,
	"settled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "operator_points" ADD CONSTRAINT "operator_points_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_points" ADD CONSTRAINT "operator_points_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_points" ADD CONSTRAINT "operator_points_unit_type_id_unit_types_id_fk" FOREIGN KEY ("unit_type_id") REFERENCES "public"."unit_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "operator_points_date_shift_employee_idx" ON "operator_points" USING btree ("date","shift","employee_id");--> statement-breakpoint
CREATE INDEX "operator_points_employee_date_idx" ON "operator_points" USING btree ("employee_id","date");