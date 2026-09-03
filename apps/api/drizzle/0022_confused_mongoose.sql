-- Ordered by hand. drizzle-kit emitted `DROP TABLE … CASCADE` first, which
-- silently took the foreign key with it and then failed on its own explicit
-- `DROP CONSTRAINT`. Dropping the column first removes the constraint, and the
-- table then drops with no CASCADE — so anything else still pointing at
-- work_areas would fail loudly here rather than be quietly severed.
ALTER TABLE "fleets" ALTER COLUMN "work_area" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "fleets" DROP COLUMN "work_area_id";--> statement-breakpoint
DROP TABLE "work_areas";--> statement-breakpoint
DROP TYPE "public"."area_type";--> statement-breakpoint
-- The menu is gone from MENU_SLUGS, and `menu_slug` is plain text, so these
-- grants would otherwise sit here forever naming a page that no longer exists.
DELETE FROM "role_permissions" WHERE "menu_slug" = 'area-kerja';
