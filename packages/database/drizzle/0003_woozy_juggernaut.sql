CREATE TYPE "public"."evaluation_status" AS ENUM('pass', 'warning', 'fail', 'missing');--> statement-breakpoint
CREATE TYPE "public"."specification_status" AS ENUM('active', 'archived');--> statement-breakpoint
ALTER TYPE "public"."field_type" ADD VALUE 'quantity';--> statement-breakpoint
ALTER TYPE "public"."field_type" ADD VALUE 'measurement';--> statement-breakpoint
ALTER TYPE "public"."field_type" ADD VALUE 'range';--> statement-breakpoint
CREATE TABLE "measurement_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"canonical_value" numeric NOT NULL,
	"canonical_unit" text NOT NULL,
	"original_value" numeric NOT NULL,
	"original_unit" text NOT NULL,
	"precision" integer,
	"uncertainty_value" numeric,
	"uncertainty_unit" text,
	"unit_registry_version" text NOT NULL,
	"measured_at" timestamp with time zone NOT NULL,
	"equipment_record_id" uuid,
	"supersedes_result_id" uuid,
	"correction_reason" text,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_results_correction_reason_check" CHECK (("measurement_results"."supersedes_result_id" is null and "measurement_results"."correction_reason" is null) or ("measurement_results"."supersedes_result_id" is not null and length(trim("measurement_results"."correction_reason")) > 0)),
	CONSTRAINT "measurement_results_uncertainty_check" CHECK ("measurement_results"."uncertainty_value" is null or "measurement_results"."uncertainty_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "specification_evaluations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"specification_revision_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"measurement_field_id" uuid NOT NULL,
	"measurement_result_id" uuid,
	"status" "evaluation_status" NOT NULL,
	"evaluated_canonical_value" numeric,
	"unit_registry_version" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"reason_code" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"evaluated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specification_evaluations_missing_value_check" CHECK (("specification_evaluations"."status" = 'missing' and "specification_evaluations"."measurement_result_id" is null and "specification_evaluations"."evaluated_canonical_value" is null) or ("specification_evaluations"."status" <> 'missing' and "specification_evaluations"."measurement_result_id" is not null and "specification_evaluations"."evaluated_canonical_value" is not null))
);
--> statement-breakpoint
CREATE TABLE "specification_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"specification_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"quantity_dimension" text NOT NULL,
	"canonical_unit" text NOT NULL,
	"target_value" numeric,
	"lower_limit" numeric,
	"upper_limit" numeric,
	"warning_lower_limit" numeric,
	"warning_upper_limit" numeric,
	"unit_registry_version" text NOT NULL,
	"change_note" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "specification_revisions_hard_limit_check" CHECK ("specification_revisions"."lower_limit" is not null or "specification_revisions"."upper_limit" is not null),
	CONSTRAINT "specification_revisions_hard_order_check" CHECK ("specification_revisions"."lower_limit" is null or "specification_revisions"."upper_limit" is null or "specification_revisions"."lower_limit" <= "specification_revisions"."upper_limit")
);
--> statement-breakpoint
CREATE TABLE "specifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"measurement_field_id" uuid NOT NULL,
	"status" "specification_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "field_definitions" DROP CONSTRAINT "field_definitions_unique_type_check";--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_results_project_id_key" ON "measurement_results" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "specification_revisions_project_id_key" ON "specification_revisions" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "specifications_project_id_key" ON "specifications" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_project_record_fk" FOREIGN KEY ("project_id","record_id") REFERENCES "public"."records"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_project_field_fk" FOREIGN KEY ("project_id","field_id") REFERENCES "public"."field_definitions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_project_equipment_fk" FOREIGN KEY ("project_id","equipment_record_id") REFERENCES "public"."records"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_results" ADD CONSTRAINT "measurement_results_project_supersedes_fk" FOREIGN KEY ("project_id","supersedes_result_id") REFERENCES "public"."measurement_results"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_evaluations" ADD CONSTRAINT "specification_evaluations_project_revision_fk" FOREIGN KEY ("project_id","specification_revision_id") REFERENCES "public"."specification_revisions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_evaluations" ADD CONSTRAINT "specification_evaluations_project_record_fk" FOREIGN KEY ("project_id","record_id") REFERENCES "public"."records"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_evaluations" ADD CONSTRAINT "specification_evaluations_project_field_fk" FOREIGN KEY ("project_id","measurement_field_id") REFERENCES "public"."field_definitions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_evaluations" ADD CONSTRAINT "specification_evaluations_project_result_fk" FOREIGN KEY ("project_id","measurement_result_id") REFERENCES "public"."measurement_results"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_revisions" ADD CONSTRAINT "specification_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specification_revisions" ADD CONSTRAINT "specification_revisions_project_specification_fk" FOREIGN KEY ("project_id","specification_id") REFERENCES "public"."specifications"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specifications" ADD CONSTRAINT "specifications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specifications" ADD CONSTRAINT "specifications_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specifications" ADD CONSTRAINT "specifications_project_measurement_field_fk" FOREIGN KEY ("project_id","measurement_field_id") REFERENCES "public"."field_definitions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "measurement_results_supersedes_key" ON "measurement_results" USING btree ("supersedes_result_id") WHERE "measurement_results"."supersedes_result_id" is not null;--> statement-breakpoint
CREATE INDEX "measurement_results_current_idx" ON "measurement_results" USING btree ("project_id","record_id","field_id","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "specification_evaluations_project_fingerprint_key" ON "specification_evaluations" USING btree ("project_id","input_fingerprint");--> statement-breakpoint
CREATE INDEX "specification_evaluations_current_idx" ON "specification_evaluations" USING btree ("project_id","record_id","measurement_field_id","evaluated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "specification_revisions_specification_number_key" ON "specification_revisions" USING btree ("specification_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "specifications_active_measurement_field_key" ON "specifications" USING btree ("measurement_field_id") WHERE "specifications"."status" = 'active';--> statement-breakpoint
CREATE INDEX "specifications_project_idx" ON "specifications" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_unique_type_check" CHECK (not "field_definitions"."unique" or "field_definitions"."field_type" in ('text', 'long_text', 'integer', 'decimal', 'date', 'datetime', 'single_select', 'user', 'quantity'));
--> statement-breakpoint
CREATE FUNCTION reject_immutable_engineering_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable engineering history cannot be changed' USING ERRCODE = 'check_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER measurement_results_immutable BEFORE UPDATE OR DELETE ON measurement_results FOR EACH ROW EXECUTE FUNCTION reject_immutable_engineering_row_change();
--> statement-breakpoint
CREATE TRIGGER specification_revisions_immutable BEFORE UPDATE OR DELETE ON specification_revisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_engineering_row_change();
--> statement-breakpoint
CREATE TRIGGER specification_evaluations_immutable BEFORE UPDATE OR DELETE ON specification_evaluations FOR EACH ROW EXECUTE FUNCTION reject_immutable_engineering_row_change();
