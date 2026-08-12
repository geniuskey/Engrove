CREATE TABLE "task_worklogs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"duration_minutes" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"remaining_estimate_before" integer,
	"remaining_estimate_after" integer,
	"row_version" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_worklogs_duration_check" CHECK ("task_worklogs"."duration_minutes" between 1 and 525600),
	CONSTRAINT "task_worklogs_note_check" CHECK (length("task_worklogs"."note") <= 2000),
	CONSTRAINT "task_worklogs_row_version_check" CHECK ("task_worklogs"."row_version" > 0),
	CONSTRAINT "task_worklogs_remaining_before_check" CHECK ("task_worklogs"."remaining_estimate_before" is null or "task_worklogs"."remaining_estimate_before" between 0 and 5256000),
	CONSTRAINT "task_worklogs_remaining_after_check" CHECK ("task_worklogs"."remaining_estimate_after" is null or "task_worklogs"."remaining_estimate_after" between 0 and 5256000),
	CONSTRAINT "task_worklogs_deleted_by_check" CHECK (("task_worklogs"."deleted_at" is null) = ("task_worklogs"."deleted_by" is null))
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "original_estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "remaining_estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "task_worklogs" ADD CONSTRAINT "task_worklogs_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_worklogs" ADD CONSTRAINT "task_worklogs_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_worklogs" ADD CONSTRAINT "task_worklogs_project_task_fk" FOREIGN KEY ("project_id","task_id") REFERENCES "public"."tasks"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_worklogs_task_started_idx" ON "task_worklogs" USING btree ("task_id","started_at","id") WHERE "task_worklogs"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "task_worklogs_author_started_idx" ON "task_worklogs" USING btree ("author_id","started_at","id") WHERE "task_worklogs"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_original_estimate_check" CHECK ("tasks"."original_estimate_minutes" is null or "tasks"."original_estimate_minutes" between 0 and 5256000);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_remaining_estimate_check" CHECK ("tasks"."remaining_estimate_minutes" is null or "tasks"."remaining_estimate_minutes" between 0 and 5256000);