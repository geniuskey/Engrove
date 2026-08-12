CREATE TABLE "task_workflow_statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"color" text NOT NULL,
	"position" integer NOT NULL,
	"initial" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_workflow_statuses_key_check" CHECK ("task_workflow_statuses"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "task_workflow_statuses_name_check" CHECK (length(btrim("task_workflow_statuses"."name")) between 1 and 80),
	CONSTRAINT "task_workflow_statuses_category_check" CHECK ("task_workflow_statuses"."category" in ('todo','in_progress','done')),
	CONSTRAINT "task_workflow_statuses_color_check" CHECK ("task_workflow_statuses"."color" in ('slate','sky','violet','amber','rose','emerald')),
	CONSTRAINT "task_workflow_statuses_position_check" CHECK ("task_workflow_statuses"."position" >= 0),
	CONSTRAINT "task_workflow_statuses_version_check" CHECK ("task_workflow_statuses"."row_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "task_workflow_transitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_workflow_transitions_name_check" CHECK (length(btrim("task_workflow_transitions"."name")) between 1 and 80),
	CONSTRAINT "task_workflow_transitions_distinct_check" CHECK ("task_workflow_transitions"."from_status" <> "task_workflow_transitions"."to_status")
);
--> statement-breakpoint
ALTER TABLE "task_status_history" ALTER COLUMN "from_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "task_status_history" ALTER COLUMN "to_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'todo';--> statement-breakpoint
ALTER TABLE "task_workflow_statuses" ADD CONSTRAINT "task_workflow_statuses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workflow_statuses" ADD CONSTRAINT "task_workflow_statuses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workflow_statuses" ADD CONSTRAINT "task_workflow_statuses_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
INSERT INTO "task_workflow_statuses"
  ("id","project_id","key","name","category","color","position","initial","created_by")
SELECT gen_random_uuid(),p.id,v.key,v.name,v.category,v.color,v.position,v.initial,p.created_by
FROM projects p
CROSS JOIN (VALUES
  ('todo','To do','todo','slate',0,true),
  ('in_progress','In progress','in_progress','sky',1,false),
  ('blocked','Blocked','in_progress','rose',2,false),
  ('done','Done','done','emerald',3,false)
) AS v(key,name,category,color,position,initial);--> statement-breakpoint
CREATE UNIQUE INDEX "task_workflow_statuses_project_key" ON "task_workflow_statuses" USING btree ("project_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "task_workflow_statuses_project_id_key" ON "task_workflow_statuses" USING btree ("project_id","id");--> statement-breakpoint
INSERT INTO "task_workflow_transitions"
  ("id","project_id","name","from_status","to_status","created_by")
SELECT gen_random_uuid(),p.id,
  CASE WHEN target.key='done' THEN 'Complete'
       WHEN source.key='done' THEN 'Reopen'
       ELSE 'Move to '||target.name END,
  source.key,target.key,p.created_by
FROM projects p
CROSS JOIN (VALUES ('todo','To do'),('in_progress','In progress'),('blocked','Blocked'),('done','Done')) source(key,name)
CROSS JOIN (VALUES ('todo','To do'),('in_progress','In progress'),('blocked','Blocked'),('done','Done')) target(key,name)
WHERE source.key<>target.key;--> statement-breakpoint
ALTER TABLE "task_workflow_transitions" ADD CONSTRAINT "task_workflow_transitions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workflow_transitions" ADD CONSTRAINT "task_workflow_transitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workflow_transitions" ADD CONSTRAINT "task_workflow_transitions_project_from_fk" FOREIGN KEY ("project_id","from_status") REFERENCES "public"."task_workflow_statuses"("project_id","key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_workflow_transitions" ADD CONSTRAINT "task_workflow_transitions_project_to_fk" FOREIGN KEY ("project_id","to_status") REFERENCES "public"."task_workflow_statuses"("project_id","key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_workflow_statuses_project_initial_key" ON "task_workflow_statuses" USING btree ("project_id") WHERE "task_workflow_statuses"."initial" and "task_workflow_statuses"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "task_workflow_statuses_project_position_idx" ON "task_workflow_statuses" USING btree ("project_id","archived_at","position");--> statement-breakpoint
CREATE UNIQUE INDEX "task_workflow_transitions_project_pair_key" ON "task_workflow_transitions" USING btree ("project_id","from_status","to_status");--> statement-breakpoint
CREATE INDEX "task_workflow_transitions_project_from_idx" ON "task_workflow_transitions" USING btree ("project_id","from_status");--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_project_from_fk" FOREIGN KEY ("project_id","from_status") REFERENCES "public"."task_workflow_statuses"("project_id","key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_project_to_fk" FOREIGN KEY ("project_id","to_status") REFERENCES "public"."task_workflow_statuses"("project_id","key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_status_fk" FOREIGN KEY ("project_id","status") REFERENCES "public"."task_workflow_statuses"("project_id","key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."task_status";
