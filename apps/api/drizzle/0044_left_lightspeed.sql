CREATE TYPE "public"."run_text_kind" AS ENUM('hazard', 'safety', 'general');--> statement-breakpoint
ALTER TABLE "run_texts" ADD COLUMN "kind" "run_text_kind" DEFAULT 'general' NOT NULL;