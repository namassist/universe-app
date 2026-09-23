ALTER TABLE "devices" ADD COLUMN "sound" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "timeline_stages" ADD COLUMN "sound_id" uuid;--> statement-breakpoint
ALTER TABLE "timeline_stages" ADD CONSTRAINT "timeline_stages_sound_id_sounds_id_fk" FOREIGN KEY ("sound_id") REFERENCES "public"."sounds"("id") ON DELETE set null ON UPDATE no action;