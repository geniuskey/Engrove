CREATE TABLE "record_batch_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_batch_requests" ADD CONSTRAINT "record_batch_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_batch_requests" ADD CONSTRAINT "record_batch_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_batch_requests" ADD CONSTRAINT "record_batch_requests_project_object_type_fk" FOREIGN KEY ("project_id","object_type_id") REFERENCES "public"."object_types"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_batch_requests_scope_key" ON "record_batch_requests" USING btree ("project_id","object_type_id","requested_by","idempotency_key");