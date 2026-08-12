ALTER TABLE "task_automation_executions" ADD COLUMN "rule_name" text;--> statement-breakpoint
ALTER TABLE "task_automation_executions" ADD COLUMN "trigger_type" text;--> statement-breakpoint
ALTER TABLE "task_automation_executions" ADD COLUMN "trigger_event" jsonb;--> statement-breakpoint
ALTER TABLE "task_automation_executions" ADD COLUMN "duration_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "task_automation_executions" e
SET "rule_name"=r."name", "trigger_type"=r."trigger_type",
    "trigger_event"=jsonb_build_object('type',r."trigger_type")
FROM "task_automation_rules" r
WHERE r."id"=e."rule_id" AND r."project_id"=e."project_id";--> statement-breakpoint
ALTER TABLE "task_automation_executions" ALTER COLUMN "rule_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_automation_executions" ALTER COLUMN "trigger_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_automation_executions" ALTER COLUMN "trigger_event" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_automation_executions" ADD CONSTRAINT "task_automation_executions_duration_check" CHECK ("task_automation_executions"."duration_ms" >= 0);--> statement-breakpoint
ALTER TABLE "task_automation_executions" ADD CONSTRAINT "task_automation_executions_trigger_json_check" CHECK (jsonb_typeof("task_automation_executions"."trigger_event")='object');
