DROP INDEX "departments_name_lower_idx";--> statement-breakpoint
DROP INDEX "positions_name_lower_idx";--> statement-breakpoint
--
-- The three columns below are NOT NULL in the schema, so they are added
-- nullable, backfilled, and only then constrained. Adding them NOT NULL in one
-- statement — which is what the generator emits — fails against any database
-- that already holds a row, and every installation of this one does.
--
-- The backfill is arbitrary, and cannot be anything else: the old schema held
-- no information about which company a department belonged to or which
-- department a position belonged to, so there is nothing to derive the answer
-- from. Existing rows are attached to the alphabetically first parent and the
-- company code is seeded from the row's own id, both of which are placeholders
-- meant to be corrected — by `db:seed`, or by hand through the master screens.
--
-- Where the parent table is empty and the child is not, the backfill leaves
-- NULL and the SET NOT NULL below fails. That is the intended outcome: it is a
-- database whose catalogues cannot be reconciled automatically, and failing
-- here is better than inventing a parent row inside a migration.
--
ALTER TABLE "companies" ADD COLUMN "code" text;--> statement-breakpoint
UPDATE "companies" SET "code" = upper(substr(replace("id"::text, '-', ''), 1, 6)) WHERE "code" IS NULL;--> statement-breakpoint
ALTER TABLE "companies" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "company_id" uuid;--> statement-breakpoint
UPDATE "departments" SET "company_id" = (SELECT "id" FROM "companies" ORDER BY lower("name") LIMIT 1) WHERE "company_id" IS NULL;--> statement-breakpoint
ALTER TABLE "departments" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "department_id" uuid;--> statement-breakpoint
UPDATE "positions" SET "department_id" = (SELECT "id" FROM "departments" ORDER BY lower("name") LIMIT 1) WHERE "department_id" IS NULL;--> statement-breakpoint
ALTER TABLE "positions" ALTER COLUMN "department_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_code_lower_idx" ON "companies" USING btree (lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_name_lower_idx" ON "departments" USING btree ("company_id",lower("name"));--> statement-breakpoint
CREATE INDEX "departments_company_id_idx" ON "departments" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_department_name_lower_idx" ON "positions" USING btree ("department_id",lower("name"));--> statement-breakpoint
CREATE INDEX "positions_department_id_idx" ON "positions" USING btree ("department_id");
