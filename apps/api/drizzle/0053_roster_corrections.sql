CREATE TABLE "roster_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"date" date NOT NULL,
	"from_code" "roster_code",
	"to_code" "roster_code" NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "roster_corrections" ADD CONSTRAINT "roster_corrections_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_corrections" ADD CONSTRAINT "roster_corrections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_corrections" ADD CONSTRAINT "roster_corrections_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_corrections_live_idx" ON "roster_corrections" USING btree ("employee_id","date") WHERE "roster_corrections"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "roster_corrections_date_idx" ON "roster_corrections" USING btree ("date");