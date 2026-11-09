CREATE TYPE "public"."person_notification_kind" AS ENUM('seat-assigned', 'seat-removed');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TABLE "person_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "person_notification_kind" NOT NULL,
	"date" date NOT NULL,
	"shift" "shift_kind" NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"available_at" timestamp with time zone NOT NULL,
	"pushed_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"session_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "person_notifications" ADD CONSTRAINT "person_notifications_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "person_notifications_employee_idx" ON "person_notifications" USING btree ("employee_id","available_at");--> statement-breakpoint
CREATE INDEX "person_notifications_unpushed_idx" ON "person_notifications" USING btree ("available_at") WHERE "person_notifications"."pushed_at" is null;--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_devices_session_idx" ON "push_devices" USING btree ("session_hash");