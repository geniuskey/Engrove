CREATE TABLE "chart_dataset_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"chart_revision_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"dataset_id" uuid NOT NULL,
	"source_role" text NOT NULL,
	"series_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"chart_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"config_version" integer NOT NULL,
	"chart_type" text NOT NULL,
	"config" jsonb NOT NULL,
	"change_note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"current_revision_id" uuid,
	"system" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"dashboard_revision_id" uuid NOT NULL,
	"card_type" text NOT NULL,
	"chart_revision_id" uuid,
	"config_version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"x" integer NOT NULL,
	"y" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "dashboard_cards_layout_check" CHECK ("dashboard_cards"."x" >= 0 and "dashboard_cards"."y" >= 0 and "dashboard_cards"."width" between 1 and 12 and "dashboard_cards"."height" between 1 and 12 and "dashboard_cards"."x" + "dashboard_cards"."width" <= 12)
);
--> statement-breakpoint
CREATE TABLE "dashboard_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"dashboard_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"layout_version" integer NOT NULL,
	"change_note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"current_revision_id" uuid,
	"system" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chart_revisions_project_id_key" ON "chart_revisions" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "charts_project_id_key" ON "charts" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_revisions_project_id_key" ON "dashboard_revisions" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_project_id_key" ON "dashboards" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "chart_dataset_sources" ADD CONSTRAINT "chart_dataset_sources_project_revision_fk" FOREIGN KEY ("project_id","chart_revision_id") REFERENCES "public"."chart_revisions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_dataset_sources" ADD CONSTRAINT "chart_dataset_sources_project_dataset_fk" FOREIGN KEY ("project_id","dataset_id") REFERENCES "public"."datasets"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_project_chart_fk" FOREIGN KEY ("project_id","chart_id") REFERENCES "public"."charts"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_cards" ADD CONSTRAINT "dashboard_cards_project_revision_fk" FOREIGN KEY ("project_id","dashboard_revision_id") REFERENCES "public"."dashboard_revisions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_cards" ADD CONSTRAINT "dashboard_cards_project_chart_revision_fk" FOREIGN KEY ("project_id","chart_revision_id") REFERENCES "public"."chart_revisions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_revisions" ADD CONSTRAINT "dashboard_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_revisions" ADD CONSTRAINT "dashboard_revisions_project_dashboard_fk" FOREIGN KEY ("project_id","dashboard_id") REFERENCES "public"."dashboards"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_project_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charts" ADD CONSTRAINT "charts_project_current_revision_fk" FOREIGN KEY ("project_id","current_revision_id") REFERENCES "public"."chart_revisions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_project_current_revision_fk" FOREIGN KEY ("project_id","current_revision_id") REFERENCES "public"."dashboard_revisions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_type_check" CHECK ("chart_type" in ('line','scatter','histogram','box_plot') and "config_version" = 1 and "revision_number" > 0);--> statement-breakpoint
ALTER TABLE "dashboard_cards" ADD CONSTRAINT "dashboard_cards_type_check" CHECK (("card_type"='chart' and "chart_revision_id" is not null) or ("card_type" in ('kpi','specification_status','recent_dataset','overdue_task') and "chart_revision_id" is null));--> statement-breakpoint
CREATE TRIGGER chart_revisions_immutable before update or delete on chart_revisions for each row execute function reject_immutable_engineering_row_change();--> statement-breakpoint
CREATE TRIGGER chart_dataset_sources_immutable before update or delete on chart_dataset_sources for each row execute function reject_immutable_engineering_row_change();--> statement-breakpoint
CREATE TRIGGER dashboard_revisions_immutable before update or delete on dashboard_revisions for each row execute function reject_immutable_engineering_row_change();--> statement-breakpoint
CREATE TRIGGER dashboard_cards_immutable before update or delete on dashboard_cards for each row execute function reject_immutable_engineering_row_change();--> statement-breakpoint
CREATE UNIQUE INDEX "chart_dataset_sources_revision_key" ON "chart_dataset_sources" USING btree ("chart_revision_id","source_key");--> statement-breakpoint
CREATE INDEX "chart_dataset_sources_dataset_idx" ON "chart_dataset_sources" USING btree ("dataset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_revisions_chart_number_key" ON "chart_revisions" USING btree ("chart_id","revision_number");--> statement-breakpoint
CREATE INDEX "charts_project_idx" ON "charts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_cards_revision_position_key" ON "dashboard_cards" USING btree ("dashboard_revision_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_revisions_dashboard_number_key" ON "dashboard_revisions" USING btree ("dashboard_id","revision_number");--> statement-breakpoint
CREATE INDEX "dashboards_project_idx" ON "dashboards" USING btree ("project_id");
