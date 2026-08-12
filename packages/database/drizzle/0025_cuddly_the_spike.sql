CREATE TABLE "record_review_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"mentioned_user_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_review_messages_body_length_check" CHECK (length(btrim("record_review_messages"."body")) between 1 and 10000)
);
--> statement-breakpoint
CREATE TABLE "record_review_threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"review_status" text DEFAULT 'discussion' NOT NULL,
	"reviewer_id" uuid,
	"created_by" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_review_threads_status_check" CHECK ("record_review_threads"."status" in ('open','resolved')),
	CONSTRAINT "record_review_threads_review_status_check" CHECK ("record_review_threads"."review_status" in ('discussion','requested','approved','changes_requested')),
	CONSTRAINT "record_review_threads_resolution_check" CHECK (("record_review_threads"."status" = 'open' and "record_review_threads"."resolved_at" is null and "record_review_threads"."resolved_by" is null)
          or ("record_review_threads"."status" = 'resolved' and "record_review_threads"."resolved_at" is not null and "record_review_threads"."resolved_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "record_review_messages" ADD CONSTRAINT "record_review_messages_thread_id_record_review_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."record_review_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_review_messages" ADD CONSTRAINT "record_review_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_review_threads" ADD CONSTRAINT "record_review_threads_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_review_threads" ADD CONSTRAINT "record_review_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_review_threads" ADD CONSTRAINT "record_review_threads_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_review_threads" ADD CONSTRAINT "record_review_threads_project_object_type_fk" FOREIGN KEY ("project_id","object_type_id") REFERENCES "public"."object_types"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_review_threads" ADD CONSTRAINT "record_review_threads_project_record_fk" FOREIGN KEY ("project_id","record_id") REFERENCES "public"."records"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_review_messages_thread_created_idx" ON "record_review_messages" USING btree ("thread_id","created_at","id");--> statement-breakpoint
CREATE INDEX "record_review_threads_record_updated_idx" ON "record_review_threads" USING btree ("record_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "record_review_threads_reviewer_idx" ON "record_review_threads" USING btree ("reviewer_id","status","updated_at");