CREATE TYPE "public"."blood_type" AS ENUM('A', 'B', 'AB', 'O');--> statement-breakpoint
CREATE TYPE "public"."employee_status" AS ENUM('aktif', 'nonaktif');--> statement-breakpoint
CREATE TYPE "public"."mcu_result" AS ENUM('Fit', 'Fit dengan catatan', 'Unfit sementara');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_skills" (
	"employee_id" uuid NOT NULL,
	"simper_code_id" uuid NOT NULL,
	CONSTRAINT "employee_skills_employee_id_simper_code_id_pk" PRIMARY KEY("employee_id","simper_code_id")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nik" text NOT NULL,
	"name" text NOT NULL,
	"company_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"mess_id" uuid,
	"simper_type_id" uuid,
	"join_date" date,
	"license" text DEFAULT '' NOT NULL,
	"simper_no" text DEFAULT '' NOT NULL,
	"simper_exp" date,
	"mcu" "mcu_result",
	"mcu_exp" date,
	"blood" "blood_type",
	"medical" text DEFAULT '' NOT NULL,
	"block" text DEFAULT '' NOT NULL,
	"room" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"emergency" text DEFAULT '' NOT NULL,
	"photo_file_name" text,
	"status" "employee_status" DEFAULT 'aktif' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_nik_unique" UNIQUE("nik")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_skills" ADD CONSTRAINT "employee_skills_simper_code_id_simper_codes_id_fk" FOREIGN KEY ("simper_code_id") REFERENCES "public"."simper_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_mess_id_mess_id_fk" FOREIGN KEY ("mess_id") REFERENCES "public"."mess"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_simper_type_id_simper_types_id_fk" FOREIGN KEY ("simper_type_id") REFERENCES "public"."simper_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_lower_idx" ON "companies" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "employee_skills_simper_code_id_idx" ON "employee_skills" USING btree ("simper_code_id");--> statement-breakpoint
CREATE INDEX "employees_department_id_idx" ON "employees" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "employees_company_id_idx" ON "employees" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "employees_position_id_idx" ON "employees" USING btree ("position_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_name_lower_idx" ON "positions" USING btree (lower("name"));