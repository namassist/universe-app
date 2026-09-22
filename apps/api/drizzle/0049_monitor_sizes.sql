-- The unsized monitor has shown two formations since 2026-09-04; it keeps
-- doing so under the name that now says so. Renamed in place, so every wall
-- stored as 'monitor' becomes 'monitor-2' with no row rewritten.
ALTER TYPE "public"."display_layout" RENAME VALUE 'monitor' TO 'monitor-2';--> statement-breakpoint
ALTER TYPE "public"."display_layout" ADD VALUE 'monitor-4';
