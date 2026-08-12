CREATE TABLE "record_comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_comments_body_length_check" CHECK (length(btrim("record_comments"."body")) between 1 and 10000),
	CONSTRAINT "record_comments_row_version_check" CHECK ("record_comments"."row_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_project_object_type_fk" FOREIGN KEY ("project_id","object_type_id") REFERENCES "public"."object_types"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_project_record_fk" FOREIGN KEY ("project_id","record_id") REFERENCES "public"."records"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_comments_record_created_idx" ON "record_comments" USING btree ("record_id","created_at","id");