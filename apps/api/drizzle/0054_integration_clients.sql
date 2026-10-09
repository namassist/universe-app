CREATE TABLE "integration_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowed_ips" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"valid_from" date DEFAULT now() NOT NULL,
	"valid_until" date,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "integration_clients_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "integration_clients" ADD CONSTRAINT "integration_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_clients" ADD CONSTRAINT "integration_clients_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_clients_live_name_idx" ON "integration_clients" USING btree (lower("name")) WHERE "integration_clients"."revoked_at" is null;