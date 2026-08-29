CREATE TYPE "public"."shift_kind" AS ENUM('day', 'night');--> statement-breakpoint
ALTER TABLE "timeline_stages" ADD COLUMN "shift" "shift_kind";--> statement-breakpoint
--- Every stage that exists at this point is part of the morning schedule: the
--- timeline was the day shift's alone until now. Keyed on `action` rather than
--- on `name`, which an operator may already have reworded. `other` markers are
--- left null — they govern no shift in particular, which is what null means.
UPDATE "timeline_stages" SET "shift" = 'day' WHERE "action" <> 'other';
