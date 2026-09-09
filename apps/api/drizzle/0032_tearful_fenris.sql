-- The key changes from (class, SIMPER code) to the unit description, so every
-- stored rank is keyed on something this table no longer has. There is nothing
-- to carry across: a rank for "SMALLDIGGER + EXC 470" does not answer "where
-- does EXCAVATOR40T belong". Emptying it first is also what lets the new column
-- be NOT NULL without inventing a default that would read as a real ordering.
--
-- The screen shows every description as "unranked" afterwards, and the yard
-- sets its order again. Nothing else in the database references these rows.
DELETE FROM "allocation_priorities";--> statement-breakpoint
ALTER TABLE "allocation_priorities" DROP CONSTRAINT "allocation_priorities_class_id_unit_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "allocation_priorities" DROP CONSTRAINT "allocation_priorities_simper_code_id_simper_codes_id_fk";
--> statement-breakpoint
DROP INDEX "allocation_priorities_pair_unique";--> statement-breakpoint
DROP INDEX "allocation_priorities_classonly_unique";--> statement-breakpoint
ALTER TABLE "allocation_priorities" ADD COLUMN "description" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_priorities_description_unique" ON "allocation_priorities" USING btree ("description");--> statement-breakpoint
ALTER TABLE "allocation_priorities" DROP COLUMN "class_id";--> statement-breakpoint
ALTER TABLE "allocation_priorities" DROP COLUMN "simper_code_id";