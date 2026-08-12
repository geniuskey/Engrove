ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_parent_fk" FOREIGN KEY ("project_id","parent_task_id") REFERENCES "public"."tasks"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_project_parent_idx" ON "tasks" USING btree ("project_id","parent_task_id","archived_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_not_self_check" CHECK ("tasks"."parent_task_id" is null or "tasks"."parent_task_id" <> "tasks"."id");