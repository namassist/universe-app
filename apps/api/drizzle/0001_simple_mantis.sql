CREATE TYPE "public"."area_type" AS ENUM('Mining', 'Non Mining');--> statement-breakpoint
CREATE TYPE "public"."timeline_action" AS ENUM('ftw-deadline', 'finger-in', 'finger-ingest', 'spare-validate', 'bus-depart', 'other');--> statement-breakpoint
CREATE TABLE "bus_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_id" uuid NOT NULL,
	"depart_at" time NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bus_schedules_unit_id_unique" UNIQUE("unit_id")
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "device_run_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" text NOT NULL,
	"text" text NOT NULL,
	"color" text NOT NULL,
	"ord" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mess" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_texts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"color" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simper_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simper_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeline_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"at" time NOT NULL,
	"action" timeline_action NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"class_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"simper_code_id" uuid,
	"department_id" uuid NOT NULL,
	"serial" text DEFAULT '' NOT NULL,
	"engine_brand" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"ftw" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"standby" boolean DEFAULT false NOT NULL,
	"breakdown" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "units_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "work_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" "area_type" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bus_schedules" ADD CONSTRAINT "bus_schedules_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_run_texts" ADD CONSTRAINT "device_run_texts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_class_id_unit_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."unit_classes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_type_id_unit_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."unit_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_model_id_unit_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."unit_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_brand_id_unit_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."unit_brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_simper_code_id_simper_codes_id_fk" FOREIGN KEY ("simper_code_id") REFERENCES "public"."simper_codes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_name_lower_idx" ON "departments" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "device_run_texts_device_id_idx" ON "device_run_texts" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mess_name_lower_idx" ON "mess" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "simper_codes_name_lower_idx" ON "simper_codes" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "simper_types_name_lower_idx" ON "simper_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "unit_brands_name_lower_idx" ON "unit_brands" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "unit_classes_name_lower_idx" ON "unit_classes" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "unit_models_name_lower_idx" ON "unit_models" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "unit_types_name_lower_idx" ON "unit_types" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "units_class_id_idx" ON "units" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "units_type_id_idx" ON "units" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "units_brand_id_idx" ON "units" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "work_areas_name_lower_idx" ON "work_areas" USING btree (lower("name"));