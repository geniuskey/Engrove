CREATE TYPE "public"."milestone_status" AS ENUM('planned', 'active', 'at_risk', 'completed');--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" "milestone_status" DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"target_date" date NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_milestones_progress_check" CHECK ("project_milestones"."progress" between 0 and 100),
	CONSTRAINT "project_milestones_date_check" CHECK ("project_milestones"."start_date" is null or "project_milestones"."start_date" <= "project_milestones"."target_date")
);
--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_milestones_project_id_key" ON "project_milestones" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "project_milestones_timeline_idx" ON "project_milestones" USING btree ("project_id","target_date","status");