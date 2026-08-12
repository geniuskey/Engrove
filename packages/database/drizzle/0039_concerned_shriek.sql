CREATE TYPE "public"."task_filter_visibility" AS ENUM('personal', 'project');--> statement-breakpoint
CREATE TABLE "task_saved_filter_favorites" (
	"filter_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_saved_filter_favorites_filter_id_user_id_pk" PRIMARY KEY("filter_id","user_id")
);
--> statement-breakpoint
DROP INDEX "task_saved_filters_project_user_name_key";--> statement-breakpoint
ALTER TABLE "task_saved_filters" ADD COLUMN "visibility" "task_filter_visibility" DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_saved_filter_favorites" ADD CONSTRAINT "task_saved_filter_favorites_filter_id_task_saved_filters_id_fk" FOREIGN KEY ("filter_id") REFERENCES "public"."task_saved_filters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_saved_filter_favorites" ADD CONSTRAINT "task_saved_filter_favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_saved_filter_favorites_user_idx" ON "task_saved_filter_favorites" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_saved_filters_personal_name_key" ON "task_saved_filters" USING btree ("project_id","user_id",lower("name")) WHERE "task_saved_filters"."visibility" = 'personal';--> statement-breakpoint
CREATE UNIQUE INDEX "task_saved_filters_project_name_key" ON "task_saved_filters" USING btree ("project_id",lower("name")) WHERE "task_saved_filters"."visibility" = 'project';--> statement-breakpoint
CREATE INDEX "task_saved_filters_project_visibility_idx" ON "task_saved_filters" USING btree ("project_id","visibility","updated_at");