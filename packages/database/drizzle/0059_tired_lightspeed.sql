CREATE TABLE "record_comment_mentions" (
	"comment_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type";--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "task_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "object_type_id" uuid;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "record_id" uuid;--> statement-breakpoint
ALTER TABLE "record_comment_mentions" ADD CONSTRAINT "record_comment_mentions_comment_id_record_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."record_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_comment_mentions" ADD CONSTRAINT "record_comment_mentions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_comment_mentions_comment_user_key" ON "record_comment_mentions" USING btree ("comment_id","user_id");--> statement-breakpoint
CREATE INDEX "record_comment_mentions_user_idx" ON "record_comment_mentions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_project_record_fk" FOREIGN KEY ("project_id","object_type_id","record_id") REFERENCES "public"."records"("project_id","object_type_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_record_idx" ON "notifications" USING btree ("record_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_target_check" CHECK ((("notifications"."type" like 'task.%') and "notifications"."task_id" is not null and "notifications"."object_type_id" is null and "notifications"."record_id" is null) or ("notifications"."type" = 'record.mentioned' and "notifications"."task_id" is null and "notifications"."object_type_id" is not null and "notifications"."record_id" is not null));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type" CHECK ("notifications"."type" in ('task.assigned','task.updated','task.status_changed','task.commented','task.mentioned','task.archived','task.restored','task.due_soon','task.overdue','record.mentioned'));