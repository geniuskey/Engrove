CREATE TYPE "public"."attempt_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dataset_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."dataset_type" AS ENUM('tabular', 'xy');--> statement-breakpoint
CREATE TYPE "public"."file_status" AS ENUM('pending_upload', 'verifying', 'available', 'failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('issued', 'verifying', 'finalized', 'expired', 'failed');--> statement-breakpoint
ALTER TYPE "public"."field_type" ADD VALUE 'file';--> statement-breakpoint
ALTER TYPE "public"."field_type" ADD VALUE 'dataset';--> statement-breakpoint
CREATE TABLE "background_job_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"worker_identity" text NOT NULL,
	"status" "attempt_status" DEFAULT 'running' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"result_checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"error_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retryable" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"job_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"input_fingerprint" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"error_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retryable" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"artifact_kind" text NOT NULL,
	"object_key" text NOT NULL,
	"storage_version_id" text,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_algorithm" text DEFAULT 'sha256' NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dataset_artifacts_object_key_unique" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"source_file_id" uuid,
	"source_dataset_id" uuid,
	"dataset_type" "dataset_type" NOT NULL,
	"name" text NOT NULL,
	"status" "dataset_status" DEFAULT 'pending' NOT NULL,
	"transformation_name" text NOT NULL,
	"transformation_version" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_fingerprint" text NOT NULL,
	"schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"statistics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_count" bigint,
	"unit_registry_version" text NOT NULL,
	"failure_code" text,
	"failure_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ready_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	CONSTRAINT "datasets_exactly_one_source_check" CHECK (num_nonnulls("datasets"."source_file_id","datasets"."source_dataset_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "file_objects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"file_series_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"previous_file_id" uuid,
	"final_object_key" text NOT NULL,
	"storage_version_id" text,
	"original_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum_algorithm" text DEFAULT 'sha256' NOT NULL,
	"checksum" text NOT NULL,
	"status" "file_status" DEFAULT 'pending_upload' NOT NULL,
	"failure_code" text,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	CONSTRAINT "file_objects_final_object_key_unique" UNIQUE("final_object_key")
);
--> statement-breakpoint
CREATE TABLE "file_series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"latest_version_number" integer DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "file_upload_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"staging_object_key" text NOT NULL,
	"expected_size_bytes" bigint NOT NULL,
	"expected_checksum" text NOT NULL,
	"status" "upload_status" DEFAULT 'issued' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_code" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "file_upload_sessions_staging_object_key_unique" UNIQUE("staging_object_key")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "measurement_results" ADD COLUMN "dataset_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_project_id_key" ON "background_jobs" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_project_id_key" ON "datasets" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_objects_project_id_key" ON "file_objects" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_series_project_id_key" ON "file_series" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "background_job_attempts" ADD CONSTRAINT "background_job_attempts_project_job_fk" FOREIGN KEY ("project_id","job_id") REFERENCES "public"."background_jobs"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_artifacts" ADD CONSTRAINT "dataset_artifacts_project_dataset_fk" FOREIGN KEY ("project_id","dataset_id") REFERENCES "public"."datasets"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_project_source_file_fk" FOREIGN KEY ("project_id","source_file_id") REFERENCES "public"."file_objects"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_project_source_dataset_fk" FOREIGN KEY ("project_id","source_dataset_id") REFERENCES "public"."datasets"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_project_series_fk" FOREIGN KEY ("project_id","file_series_id") REFERENCES "public"."file_series"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_project_previous_fk" FOREIGN KEY ("project_id","previous_file_id") REFERENCES "public"."file_objects"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_series" ADD CONSTRAINT "file_series_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_series" ADD CONSTRAINT "file_series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_series" ADD CONSTRAINT "file_series_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_upload_sessions" ADD CONSTRAINT "file_upload_sessions_project_file_fk" FOREIGN KEY ("project_id","file_id") REFERENCES "public"."file_objects"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_project_dataset_fk" FOREIGN KEY ("project_id","dataset_id") REFERENCES "public"."datasets"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "background_job_attempts_job_number_key" ON "background_job_attempts" USING btree ("job_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_project_fingerprint_key" ON "background_jobs" USING btree ("project_id","input_fingerprint");--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_artifacts_dataset_kind_key" ON "dataset_artifacts" USING btree ("dataset_id","artifact_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "datasets_project_fingerprint_key" ON "datasets" USING btree ("project_id","input_fingerprint");--> statement-breakpoint
CREATE INDEX "datasets_project_status_idx" ON "datasets" USING btree ("project_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "file_objects_series_version_key" ON "file_objects" USING btree ("file_series_id","version_number");--> statement-breakpoint
CREATE INDEX "file_objects_project_idx" ON "file_objects" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "file_series_project_idx" ON "file_series" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "file_upload_sessions_project_id_key" ON "file_upload_sessions" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "file_upload_sessions_expiry_idx" ON "file_upload_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "outbox_undispatched_idx" ON "outbox_events" USING btree ("dispatched_at","created_at");
--> statement-breakpoint
CREATE FUNCTION protect_available_file_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'available' AND (NEW.final_object_key,NEW.storage_version_id,NEW.size_bytes,NEW.checksum_algorithm,NEW.checksum,NEW.original_name,NEW.content_type) IS DISTINCT FROM (OLD.final_object_key,OLD.storage_version_id,OLD.size_bytes,OLD.checksum_algorithm,OLD.checksum,OLD.original_name,OLD.content_type) THEN RAISE EXCEPTION 'available file content is immutable' USING ERRCODE='check_violation'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER file_objects_content_immutable BEFORE UPDATE ON file_objects FOR EACH ROW EXECUTE FUNCTION protect_available_file_content();
--> statement-breakpoint
CREATE FUNCTION protect_ready_dataset_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'ready' AND (NEW.source_file_id,NEW.source_dataset_id,NEW.dataset_type,NEW.transformation_name,NEW.transformation_version,NEW.parameters,NEW.input_fingerprint,NEW.schema,NEW.statistics,NEW.row_count,NEW.unit_registry_version) IS DISTINCT FROM (OLD.source_file_id,OLD.source_dataset_id,OLD.dataset_type,OLD.transformation_name,OLD.transformation_version,OLD.parameters,OLD.input_fingerprint,OLD.schema,OLD.statistics,OLD.row_count,OLD.unit_registry_version) THEN RAISE EXCEPTION 'ready dataset content is immutable' USING ERRCODE='check_violation'; END IF;
  RETURN NEW;
END; $$;
--> statement-breakpoint
CREATE TRIGGER datasets_content_immutable BEFORE UPDATE ON datasets FOR EACH ROW EXECUTE FUNCTION protect_ready_dataset_content();
--> statement-breakpoint
CREATE TRIGGER dataset_artifacts_immutable BEFORE UPDATE OR DELETE ON dataset_artifacts FOR EACH ROW EXECUTE FUNCTION reject_immutable_engineering_row_change();
