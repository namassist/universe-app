CREATE TYPE "public"."roster_document_source" AS ENUM('upload', 'unggul');--> statement-breakpoint
ALTER TABLE "roster_documents" ALTER COLUMN "uploaded_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "roster_documents" ADD COLUMN "source" "roster_document_source" DEFAULT 'upload' NOT NULL;