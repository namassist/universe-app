CREATE TYPE "public"."roster_code" AS ENUM('D', 'N', 'R', 'STB', 'OFF', 'CR', 'AL', 'LWP', 'LWOP', 'PH', 'PHD', 'S', 'A', 'MCU', 'MCR', 'MCUF', 'ISM', 'OBC', 'KRT', 'TGS', 'DNS', 'TRV', 'TR', 'TRS', 'IN', 'TERM', 'EOC', 'RSG');--> statement-breakpoint
CREATE TYPE "public"."roster_document_status" AS ENUM('aktif', 'arsip');--> statement-breakpoint
CREATE TYPE "public"."roster_revision_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "roster_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"code" "roster_code" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"department_id" uuid NOT NULL,
	"month" date NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"status" "roster_document_status" DEFAULT 'aktif' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_revision_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"revision_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"from_code" "roster_code" NOT NULL,
	"to_code" "roster_code" NOT NULL,
	"start_time" time,
	"end_time" time,
	"reason" text NOT NULL,
	"status" "roster_revision_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roster_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"document_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_revisions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "roster_days" ADD CONSTRAINT "roster_days_document_id_roster_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."roster_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_days" ADD CONSTRAINT "roster_days_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_documents" ADD CONSTRAINT "roster_documents_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_documents" ADD CONSTRAINT "roster_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_revision_items" ADD CONSTRAINT "roster_revision_items_revision_id_roster_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."roster_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_revision_items" ADD CONSTRAINT "roster_revision_items_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_revision_items" ADD CONSTRAINT "roster_revision_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_revisions" ADD CONSTRAINT "roster_revisions_document_id_roster_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."roster_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_revisions" ADD CONSTRAINT "roster_revisions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_days_document_employee_date_idx" ON "roster_days" USING btree ("document_id","employee_id","date");--> statement-breakpoint
CREATE INDEX "roster_days_date_code_idx" ON "roster_days" USING btree ("date","code");--> statement-breakpoint
CREATE INDEX "roster_days_employee_date_idx" ON "roster_days" USING btree ("employee_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_documents_active_month_idx" ON "roster_documents" USING btree ("department_id","month") WHERE "roster_documents"."status" = 'aktif';--> statement-breakpoint
CREATE INDEX "roster_documents_department_id_idx" ON "roster_documents" USING btree ("department_id");--> statement-breakpoint
CREATE INDEX "roster_revision_items_revision_id_idx" ON "roster_revision_items" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "roster_revision_items_status_idx" ON "roster_revision_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "roster_revision_items_employee_date_idx" ON "roster_revision_items" USING btree ("employee_id","date");--> statement-breakpoint
CREATE INDEX "roster_revisions_document_id_idx" ON "roster_revisions" USING btree ("document_id");