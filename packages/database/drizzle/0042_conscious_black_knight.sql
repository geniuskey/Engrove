CREATE TABLE "task_link_removals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"removed_by" uuid NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER task_link_removals_immutable before update or delete on task_link_removals for each row execute function reject_immutable_engineering_row_change();--> statement-breakpoint
ALTER TABLE "task_link_removals" ADD CONSTRAINT "task_link_removals_link_id_task_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."task_links"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_link_removals" ADD CONSTRAINT "task_link_removals_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "task_link_removals_link_key" ON "task_link_removals" USING btree ("link_id");--> statement-breakpoint
CREATE INDEX "task_link_removals_actor_idx" ON "task_link_removals" USING btree ("removed_by","removed_at");
