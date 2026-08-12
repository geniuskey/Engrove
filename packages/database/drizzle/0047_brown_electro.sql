CREATE TABLE "project_milestone_tasks" (
	"project_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"linked_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_milestone_tasks_pk" PRIMARY KEY("project_id","milestone_id","task_id")
);
--> statement-breakpoint
ALTER TABLE "project_milestone_tasks" ADD CONSTRAINT "project_milestone_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone_tasks" ADD CONSTRAINT "project_milestone_tasks_linked_by_users_id_fk" FOREIGN KEY ("linked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone_tasks" ADD CONSTRAINT "project_milestone_tasks_project_milestone_fk" FOREIGN KEY ("project_id","milestone_id") REFERENCES "public"."project_milestones"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestone_tasks" ADD CONSTRAINT "project_milestone_tasks_project_task_fk" FOREIGN KEY ("project_id","task_id") REFERENCES "public"."tasks"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_milestone_tasks_task_idx" ON "project_milestone_tasks" USING btree ("project_id","task_id");