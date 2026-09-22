CREATE TYPE "public"."card_layout" AS ENUM('overlay', 'identity');--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "card_layout" "card_layout" DEFAULT 'overlay' NOT NULL;