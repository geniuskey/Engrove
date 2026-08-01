CREATE TYPE "public"."field_type" AS ENUM('text', 'long_text', 'integer', 'decimal', 'boolean', 'date', 'datetime', 'single_select', 'multi_select', 'user', 'relation');--> statement-breakpoint
CREATE TYPE "public"."projection_status" AS ENUM('ready', 'rebuilding', 'failed');--> statement-breakpoint
CREATE TYPE "public"."record_value_kind" AS ENUM('text', 'numeric', 'boolean', 'date', 'datetime', 'uuid');--> statement-breakpoint
CREATE TABLE "csv_imports" (
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
CREATE TABLE "field_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"field_type" "field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"unique" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"default_value" jsonb,
	"system" boolean DEFAULT false NOT NULL,
	"projection_status" "projection_status" DEFAULT 'ready' NOT NULL,
	"projection_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_definitions_unique_type_check" CHECK (not "field_definitions"."unique" or "field_definitions"."field_type" in ('text', 'long_text', 'integer', 'decimal', 'date', 'datetime', 'single_select', 'user'))
);
--> statement-breakpoint
CREATE TABLE "object_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"plural_name" text NOT NULL,
	"key" text NOT NULL,
	"icon" text DEFAULT 'table' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_index_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"ordinal" integer DEFAULT 0 NOT NULL,
	"value_kind" "record_value_kind" NOT NULL,
	"text_value" text,
	"numeric_value" numeric,
	"boolean_value" boolean,
	"date_value" date,
	"datetime_value" timestamp with time zone,
	"uuid_value" uuid,
	"unique_key" text,
	"projection_version" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "record_index_values_exactly_one_value_check" CHECK (num_nonnulls("record_index_values"."text_value", "record_index_values"."numeric_value", "record_index_values"."boolean_value", "record_index_values"."date_value", "record_index_values"."datetime_value", "record_index_values"."uuid_value") = 1)
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relation_edges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"source_record_id" uuid NOT NULL,
	"source_field_id" uuid NOT NULL,
	"target_record_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"version" integer NOT NULL,
	"installed_by" uuid NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "object_types_project_id_key" ON "object_types" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_definitions_project_id_key" ON "field_definitions" USING btree ("project_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "records_project_id_key" ON "records" USING btree ("project_id","id");--> statement-breakpoint
ALTER TABLE "csv_imports" ADD CONSTRAINT "csv_imports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_imports" ADD CONSTRAINT "csv_imports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_imports" ADD CONSTRAINT "csv_imports_project_object_type_fk" FOREIGN KEY ("project_id","object_type_id") REFERENCES "public"."object_types"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definitions" ADD CONSTRAINT "field_definitions_project_object_type_fk" FOREIGN KEY ("project_id","object_type_id") REFERENCES "public"."object_types"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_types" ADD CONSTRAINT "object_types_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_index_values" ADD CONSTRAINT "record_index_values_project_record_fk" FOREIGN KEY ("project_id","record_id") REFERENCES "public"."records"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_index_values" ADD CONSTRAINT "record_index_values_project_field_fk" FOREIGN KEY ("project_id","field_id") REFERENCES "public"."field_definitions"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_project_object_type_fk" FOREIGN KEY ("project_id","object_type_id") REFERENCES "public"."object_types"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_edges" ADD CONSTRAINT "relation_edges_project_source_record_fk" FOREIGN KEY ("project_id","source_record_id") REFERENCES "public"."records"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_edges" ADD CONSTRAINT "relation_edges_project_source_field_fk" FOREIGN KEY ("project_id","source_field_id") REFERENCES "public"."field_definitions"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_edges" ADD CONSTRAINT "relation_edges_project_target_record_fk" FOREIGN KEY ("project_id","target_record_id") REFERENCES "public"."records"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_installations" ADD CONSTRAINT "template_installations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_installations" ADD CONSTRAINT "template_installations_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "csv_imports_project_actor_key" ON "csv_imports" USING btree ("project_id","requested_by","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "field_definitions_object_key_key" ON "field_definitions" USING btree ("object_type_id","key");--> statement-breakpoint
CREATE INDEX "field_definitions_object_order_idx" ON "field_definitions" USING btree ("object_type_id","position","id");--> statement-breakpoint
CREATE UNIQUE INDEX "object_types_project_key_key" ON "object_types" USING btree ("project_id","key");--> statement-breakpoint
CREATE INDEX "object_types_project_idx" ON "object_types" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_index_values_record_field_ordinal_key" ON "record_index_values" USING btree ("record_id","field_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "record_index_values_field_unique_key" ON "record_index_values" USING btree ("field_id","unique_key") WHERE "record_index_values"."unique_key" is not null;--> statement-breakpoint
CREATE INDEX "record_index_values_filter_idx" ON "record_index_values" USING btree ("field_id","record_id");--> statement-breakpoint
CREATE INDEX "records_object_updated_idx" ON "records" USING btree ("object_type_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "relation_edges_source_field_target_key" ON "relation_edges" USING btree ("source_record_id","source_field_id","target_record_id");--> statement-breakpoint
CREATE INDEX "relation_edges_target_idx" ON "relation_edges" USING btree ("target_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "template_installations_project_template_key" ON "template_installations" USING btree ("project_id","template_key");
