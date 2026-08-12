CREATE TABLE "task_automation_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"trace_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"outcome" text NOT NULL,
	"changes" jsonb NOT NULL,
	"error_code" text,
	"executed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_automation_executions_depth_check" CHECK ("task_automation_executions"."depth" between 0 and 10),
	CONSTRAINT "task_automation_executions_outcome_check" CHECK ("task_automation_executions"."outcome" in ('succeeded','no_change','failed')),
	CONSTRAINT "task_automation_executions_changes_json_check" CHECK (jsonb_typeof("task_automation_executions"."changes")='object')
);
--> statement-breakpoint
CREATE TABLE "task_automation_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"trigger_type" text NOT NULL,
	"trigger_config" jsonb NOT NULL,
	"condition_config" jsonb NOT NULL,
	"action_config" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"execution_count" integer DEFAULT 0 NOT NULL,
	"last_executed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_automation_rules_trigger_type_check" CHECK ("task_automation_rules"."trigger_type" in ('task.created','task.status_changed','task.priority_changed','task.assignee_changed')),
	CONSTRAINT "task_automation_rules_trigger_json_check" CHECK (jsonb_typeof("task_automation_rules"."trigger_config")='object'),
	CONSTRAINT "task_automation_rules_condition_json_check" CHECK (jsonb_typeof("task_automation_rules"."condition_config")='object'),
	CONSTRAINT "task_automation_rules_action_json_check" CHECK (jsonb_typeof("task_automation_rules"."action_config")='object'),
	CONSTRAINT "task_automation_rules_execution_count_check" CHECK ("task_automation_rules"."execution_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "task_automation_executions" ADD CONSTRAINT "task_automation_executions_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_automation_rules_project_id_key" ON "task_automation_rules" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "task_automation_executions" ADD CONSTRAINT "task_automation_executions_project_rule_fk" FOREIGN KEY ("project_id","rule_id") REFERENCES "public"."task_automation_rules"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_executions" ADD CONSTRAINT "task_automation_executions_project_task_fk" FOREIGN KEY ("project_id","task_id") REFERENCES "public"."tasks"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_rules" ADD CONSTRAINT "task_automation_rules_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_automation_rules" ADD CONSTRAINT "task_automation_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_automation_executions_rule_trace_key" ON "task_automation_executions" USING btree ("rule_id","trace_id");--> statement-breakpoint
CREATE INDEX "task_automation_executions_project_created_idx" ON "task_automation_executions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "task_automation_rules_project_name_key" ON "task_automation_rules" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "task_automation_rules_project_trigger_idx" ON "task_automation_rules" USING btree ("project_id","active","trigger_type");
