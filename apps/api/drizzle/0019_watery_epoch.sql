CREATE TYPE "public"."display_layout" AS ENUM('slideshow', 'monitor');--> statement-breakpoint
ALTER TABLE "device_fleets" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "layout" "display_layout" DEFAULT 'slideshow' NOT NULL;