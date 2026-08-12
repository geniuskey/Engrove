CREATE TABLE "task_relationships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"source_task_id" uuid NOT NULL,
	"target_task_id" uuid NOT NULL,
	"relation_type" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_relationships_distinct_tasks" CHECK ("task_relationships"."source_task_id" <> "task_relationships"."target_task_id"),
	CONSTRAINT "task_relationships_type_check" CHECK ("task_relationships"."relation_type" in ('blocks','relates_to')),
	CONSTRAINT "task_relationships_relates_order_check" CHECK ("task_relationships"."relation_type" <> 'relates_to' or "task_relationships"."source_task_id" < "task_relationships"."target_task_id")
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"auto_watch_created" boolean DEFAULT true NOT NULL,
	"auto_watch_commented" boolean DEFAULT true NOT NULL,
	"notify_assigned" boolean DEFAULT true NOT NULL,
	"notify_mentioned" boolean DEFAULT true NOT NULL,
	"notify_task_activity" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_preferences_organization_user_pk" PRIMARY KEY("organization_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "task_relationships" ADD CONSTRAINT "task_relationships_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relationships" ADD CONSTRAINT "task_relationships_project_source_fk" FOREIGN KEY ("project_id","source_task_id") REFERENCES "public"."tasks"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relationships" ADD CONSTRAINT "task_relationships_project_target_fk" FOREIGN KEY ("project_id","target_task_id") REFERENCES "public"."tasks"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_relationships_project_type_pair_key" ON "task_relationships" USING btree ("project_id","relation_type","source_task_id","target_task_id");--> statement-breakpoint
CREATE INDEX "task_relationships_source_idx" ON "task_relationships" USING btree ("project_id","source_task_id");--> statement-breakpoint
CREATE INDEX "task_relationships_target_idx" ON "task_relationships" USING btree ("project_id","target_task_id");--> statement-breakpoint
CREATE INDEX "user_notification_preferences_user_idx" ON "user_notification_preferences" USING btree ("user_id");