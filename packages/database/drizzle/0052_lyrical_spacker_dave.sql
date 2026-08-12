CREATE TABLE "record_view_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"record_view_id" uuid NOT NULL,
	"token_prefix" text NOT NULL,
	"token_hash" text NOT NULL,
	"password_hash" text,
	"allow_download" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"access_count" bigint DEFAULT 0 NOT NULL,
	"last_accessed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_view_shares_token_prefix_check" CHECK (length("record_view_shares"."token_prefix") between 8 and 20),
	CONSTRAINT "record_view_shares_row_version_check" CHECK ("record_view_shares"."row_version" > 0),
	CONSTRAINT "record_view_shares_access_count_check" CHECK ("record_view_shares"."access_count" >= 0),
	CONSTRAINT "record_view_shares_expiry_check" CHECK ("record_view_shares"."expires_at" is null or "record_view_shares"."expires_at" > "record_view_shares"."created_at")
);
--> statement-breakpoint
ALTER TABLE "record_view_shares" ADD CONSTRAINT "record_view_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_view_shares" ADD CONSTRAINT "record_view_shares_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_view_shares" ADD CONSTRAINT "record_view_shares_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_view_shares" ADD CONSTRAINT "record_view_shares_project_view_fk" FOREIGN KEY ("project_id","record_view_id") REFERENCES "public"."record_views"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_view_shares_token_hash_key" ON "record_view_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "record_view_shares_active_view_key" ON "record_view_shares" USING btree ("record_view_id") WHERE "record_view_shares"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "record_view_shares_expiry_idx" ON "record_view_shares" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "record_view_shares_project_created_idx" ON "record_view_shares" USING btree ("project_id","created_at","id");