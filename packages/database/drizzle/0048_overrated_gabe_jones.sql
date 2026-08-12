CREATE TABLE "project_idempotency_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	CONSTRAINT "project_idempotency_requests_operation_check" CHECK ("project_idempotency_requests"."operation" in ('task.create','milestone.create')),
	CONSTRAINT "project_idempotency_requests_key_length_check" CHECK (length("project_idempotency_requests"."idempotency_key") between 8 and 200)
);
--> statement-breakpoint
ALTER TABLE "project_idempotency_requests" ADD CONSTRAINT "project_idempotency_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_idempotency_requests" ADD CONSTRAINT "project_idempotency_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_idempotency_requests_scope_key" ON "project_idempotency_requests" USING btree ("project_id","operation","requested_by","idempotency_key");--> statement-breakpoint
CREATE INDEX "project_idempotency_requests_expiry_idx" ON "project_idempotency_requests" USING btree ("expires_at");