CREATE TABLE "onboarding_progress" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"completed_steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pilot_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"actor_id" uuid NOT NULL,
	"category" text NOT NULL,
	"rating" integer NOT NULL,
	"message" text NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pilot_feedback_category_check" CHECK ("pilot_feedback"."category" in ('bug','usability','workflow','idea','other')),
	CONSTRAINT "pilot_feedback_rating_check" CHECK ("pilot_feedback"."rating" between 1 and 5),
	CONSTRAINT "pilot_feedback_status_check" CHECK ("pilot_feedback"."status" in ('new','reviewed','resolved'))
);
--> statement-breakpoint
CREATE TABLE "project_demo_installations" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"template_version" integer NOT NULL,
	"file_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"chart_id" uuid NOT NULL,
	"test_run_record_id" uuid NOT NULL,
	"installed_by" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_progress" ADD CONSTRAINT "onboarding_progress_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_feedback" ADD CONSTRAINT "pilot_feedback_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_feedback" ADD CONSTRAINT "pilot_feedback_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pilot_feedback" ADD CONSTRAINT "pilot_feedback_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_demo_installations" ADD CONSTRAINT "project_demo_installations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_demo_installations" ADD CONSTRAINT "project_demo_installations_file_id_file_objects_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file_objects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_demo_installations" ADD CONSTRAINT "project_demo_installations_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_demo_installations" ADD CONSTRAINT "project_demo_installations_chart_id_charts_id_fk" FOREIGN KEY ("chart_id") REFERENCES "public"."charts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_demo_installations" ADD CONSTRAINT "project_demo_installations_test_run_record_id_records_id_fk" FOREIGN KEY ("test_run_record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_demo_installations" ADD CONSTRAINT "project_demo_installations_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pilot_feedback_organization_created_idx" ON "pilot_feedback" USING btree ("organization_id","created_at");