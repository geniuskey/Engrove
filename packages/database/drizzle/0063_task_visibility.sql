CREATE TYPE "public"."task_visibility" AS ENUM('project', 'restricted');--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "visibility" "task_visibility" DEFAULT 'project' NOT NULL;--> statement-breakpoint
CREATE TABLE "task_visibility_subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_visibility_subjects_exactly_one_subject_check" CHECK (("task_visibility_subjects"."user_id" is null) <> ("task_visibility_subjects"."group_id" is null))
);--> statement-breakpoint
ALTER TABLE "task_visibility_subjects" ADD CONSTRAINT "task_visibility_subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_visibility_subjects" ADD CONSTRAINT "task_visibility_subjects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_visibility_subjects" ADD CONSTRAINT "task_visibility_subjects_project_task_fk" FOREIGN KEY ("project_id","task_id") REFERENCES "public"."tasks"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_visibility_subjects" ADD CONSTRAINT "task_visibility_subjects_organization_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."member_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_visibility_subjects_user_key" ON "task_visibility_subjects" USING btree ("task_id","user_id") WHERE "task_visibility_subjects"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "task_visibility_subjects_group_key" ON "task_visibility_subjects" USING btree ("task_id","group_id") WHERE "task_visibility_subjects"."group_id" is not null;--> statement-breakpoint
CREATE INDEX "task_visibility_subjects_task_idx" ON "task_visibility_subjects" USING btree ("task_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION task_visible_to(candidate_task_id uuid, candidate_actor_id uuid, candidate_actor_role text)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tasks task
    WHERE task.id = candidate_task_id
      AND (
        task.visibility = 'project'
        OR candidate_actor_role IN ('owner', 'admin', 'engineer')
        OR task.created_by = candidate_actor_id
        OR task.assignee_id = candidate_actor_id
        OR EXISTS (
          SELECT 1 FROM task_visibility_subjects subject
          WHERE subject.task_id = task.id AND subject.user_id = candidate_actor_id
        )
        OR EXISTS (
          SELECT 1
          FROM task_visibility_subjects subject
          JOIN member_groups member_group
            ON member_group.organization_id = subject.organization_id
           AND member_group.id = subject.group_id
           AND member_group.archived_at IS NULL
          JOIN member_group_memberships group_member
            ON group_member.organization_id = subject.organization_id
           AND group_member.group_id = subject.group_id
          WHERE subject.task_id = task.id AND group_member.user_id = candidate_actor_id
        )
      )
  )
$$;
