ALTER TABLE "tasks" ADD COLUMN "board_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
WITH "ranked_tasks" AS (
	SELECT "tasks"."id", (row_number() OVER (
		PARTITION BY "tasks"."project_id"
		ORDER BY "task_workflow_statuses"."position", "tasks"."due_date" NULLS LAST, "tasks"."updated_at" DESC, "tasks"."id"
	) * 1024)::integer AS "board_position"
	FROM "tasks"
	INNER JOIN "task_workflow_statuses"
		ON "task_workflow_statuses"."project_id" = "tasks"."project_id"
		AND "task_workflow_statuses"."key" = "tasks"."status"
)
UPDATE "tasks"
SET "board_position" = "ranked_tasks"."board_position"
FROM "ranked_tasks"
WHERE "tasks"."id" = "ranked_tasks"."id";--> statement-breakpoint
CREATE INDEX "tasks_project_board_position_idx" ON "tasks" USING btree ("project_id","status","archived_at","board_position","id");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_position_check" CHECK ("tasks"."board_position" >= 0);
