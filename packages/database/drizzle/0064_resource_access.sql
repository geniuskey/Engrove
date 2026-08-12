CREATE TYPE "public"."workspace_visibility" AS ENUM('organization', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."project_visibility" AS ENUM('workspace', 'restricted');--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "visibility" "workspace_visibility" DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "access_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "visibility" "project_visibility" DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "access_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_key" UNIQUE("workspace_id","id");--> statement-breakpoint
CREATE TABLE "workspace_access_subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_access_subjects_exactly_one_subject_check" CHECK (("workspace_access_subjects"."user_id" is null) <> ("workspace_access_subjects"."group_id" is null))
);--> statement-breakpoint
CREATE TABLE "project_access_subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_access_subjects_exactly_one_subject_check" CHECK (("project_access_subjects"."user_id" is null) <> ("project_access_subjects"."group_id" is null))
);--> statement-breakpoint
ALTER TABLE "workspace_access_subjects" ADD CONSTRAINT "workspace_access_subjects_organization_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_access_subjects" ADD CONSTRAINT "workspace_access_subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_access_subjects" ADD CONSTRAINT "workspace_access_subjects_organization_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."member_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_access_subjects" ADD CONSTRAINT "workspace_access_subjects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_subjects" ADD CONSTRAINT "project_access_subjects_organization_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_subjects" ADD CONSTRAINT "project_access_subjects_workspace_project_fk" FOREIGN KEY ("workspace_id","project_id") REFERENCES "public"."projects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_subjects" ADD CONSTRAINT "project_access_subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_subjects" ADD CONSTRAINT "project_access_subjects_organization_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."member_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_access_subjects" ADD CONSTRAINT "project_access_subjects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_access_subjects_user_key" ON "workspace_access_subjects" USING btree ("workspace_id","user_id") WHERE "workspace_access_subjects"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_access_subjects_group_key" ON "workspace_access_subjects" USING btree ("workspace_id","group_id") WHERE "workspace_access_subjects"."group_id" is not null;--> statement-breakpoint
CREATE INDEX "workspace_access_subjects_workspace_idx" ON "workspace_access_subjects" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_access_subjects_user_key" ON "project_access_subjects" USING btree ("project_id","user_id") WHERE "project_access_subjects"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "project_access_subjects_group_key" ON "project_access_subjects" USING btree ("project_id","group_id") WHERE "project_access_subjects"."group_id" is not null;--> statement-breakpoint
CREATE INDEX "project_access_subjects_project_idx" ON "project_access_subjects" USING btree ("project_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION workspace_visible_to(candidate_workspace_id uuid, candidate_organization_id uuid, candidate_actor_id uuid, candidate_actor_role text)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workspaces workspace
    WHERE workspace.id = candidate_workspace_id
      AND workspace.organization_id = candidate_organization_id
      AND (
        workspace.visibility = 'organization'
        OR candidate_actor_role IN ('owner', 'admin')
        OR workspace.created_by = candidate_actor_id
        OR EXISTS (
          SELECT 1 FROM workspace_access_subjects subject
          WHERE subject.workspace_id = workspace.id AND subject.user_id = candidate_actor_id
        )
        OR EXISTS (
          SELECT 1
          FROM workspace_access_subjects subject
          JOIN member_groups member_group
            ON member_group.organization_id = subject.organization_id
           AND member_group.id = subject.group_id
           AND member_group.archived_at IS NULL
          JOIN member_group_memberships group_member
            ON group_member.organization_id = subject.organization_id
           AND group_member.group_id = subject.group_id
          WHERE subject.workspace_id = workspace.id AND group_member.user_id = candidate_actor_id
        )
      )
  )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION project_visible_to(candidate_project_id uuid, candidate_workspace_id uuid, candidate_organization_id uuid, candidate_actor_id uuid, candidate_actor_role text)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT workspace_visible_to(candidate_workspace_id, candidate_organization_id, candidate_actor_id, candidate_actor_role)
    AND EXISTS (
      SELECT 1
      FROM projects project
      WHERE project.id = candidate_project_id
        AND project.workspace_id = candidate_workspace_id
        AND (
          project.visibility = 'workspace'
          OR candidate_actor_role IN ('owner', 'admin')
          OR project.created_by = candidate_actor_id
          OR EXISTS (
            SELECT 1 FROM project_access_subjects subject
            WHERE subject.project_id = project.id AND subject.user_id = candidate_actor_id
          )
          OR EXISTS (
            SELECT 1
            FROM project_access_subjects subject
            JOIN member_groups member_group
              ON member_group.organization_id = subject.organization_id
             AND member_group.id = subject.group_id
             AND member_group.archived_at IS NULL
            JOIN member_group_memberships group_member
              ON group_member.organization_id = subject.organization_id
             AND group_member.group_id = subject.group_id
            WHERE subject.project_id = project.id AND group_member.user_id = candidate_actor_id
          )
        )
    )
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION task_visible_to(candidate_task_id uuid, candidate_actor_id uuid, candidate_actor_role text)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM tasks task
    JOIN projects project ON project.id = task.project_id
    JOIN workspaces workspace ON workspace.id = project.workspace_id
    WHERE task.id = candidate_task_id
      AND project_visible_to(project.id, workspace.id, workspace.organization_id, candidate_actor_id, candidate_actor_role)
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
