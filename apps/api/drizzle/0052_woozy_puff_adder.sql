CREATE TYPE "public"."slide_grid" AS ENUM('6x2', '6x3');--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "slide_grid" "slide_grid" DEFAULT '6x2' NOT NULL;