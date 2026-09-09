CREATE TABLE "allocation_priorities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"class_id" uuid NOT NULL,
	"simper_code_id" uuid,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "allocation_priorities" ADD CONSTRAINT "allocation_priorities_class_id_unit_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."unit_classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocation_priorities" ADD CONSTRAINT "allocation_priorities_simper_code_id_simper_codes_id_fk" FOREIGN KEY ("simper_code_id") REFERENCES "public"."simper_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_priorities_pair_unique" ON "allocation_priorities" USING btree ("class_id","simper_code_id") WHERE simper_code_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_priorities_classonly_unique" ON "allocation_priorities" USING btree ("class_id") WHERE simper_code_id is null;--> statement-breakpoint
CREATE INDEX "allocation_priorities_rank_idx" ON "allocation_priorities" USING btree ("rank");