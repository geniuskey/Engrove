ALTER TABLE "tasks" ADD COLUMN "task_number" integer;--> statement-breakpoint
WITH "numbered_tasks" AS (
	SELECT "id", row_number() OVER (
		PARTITION BY "project_id" ORDER BY "created_at", "id"
	)::integer AS "task_number"
	FROM "tasks"
)
UPDATE "tasks"
SET "task_number" = "numbered_tasks"."task_number"
FROM "numbered_tasks"
WHERE "tasks"."id" = "numbered_tasks"."id";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "task_number" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_project_number_key" ON "tasks" USING btree ("project_id","task_number");
