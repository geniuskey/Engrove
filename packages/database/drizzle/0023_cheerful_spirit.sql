CREATE TABLE "external_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"url" text NOT NULL,
	"external_id" text DEFAULT '' NOT NULL,
	"version" text DEFAULT '' NOT NULL,
	"observed_on" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "external_sources_url_check" CHECK ("external_sources"."url" ~ '^https?://[^[:space:]]+$')
);
--> statement-breakpoint
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "external_sources_project_id_key" ON "external_sources" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "external_sources_project_updated_idx" ON "external_sources" USING btree ("project_id","archived_at","updated_at");--> statement-breakpoint
CREATE INDEX "external_sources_provider_idx" ON "external_sources" USING btree ("project_id","provider");