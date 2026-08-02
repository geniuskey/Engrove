CREATE TABLE "record_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"view_type" text DEFAULT 'grid' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_views_type_check" CHECK ("record_views"."view_type" = 'grid'),
	CONSTRAINT "record_views_row_version_check" CHECK ("record_views"."row_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_project_object_type_fk" FOREIGN KEY ("project_id","object_type_id") REFERENCES "public"."object_types"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_views_active_object_name_key" ON "record_views" USING btree ("object_type_id",lower("name")) WHERE "record_views"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "record_views_project_id_key" ON "record_views" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "record_views_object_updated_idx" ON "record_views" USING btree ("object_type_id","updated_at","id");