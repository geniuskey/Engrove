CREATE TABLE "task_saved_filters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_saved_filters" ADD CONSTRAINT "task_saved_filters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_saved_filters" ADD CONSTRAINT "task_saved_filters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_saved_filters_project_user_name_key" ON "task_saved_filters" USING btree ("project_id","user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "task_saved_filters_user_idx" ON "task_saved_filters" USING btree ("user_id","updated_at");