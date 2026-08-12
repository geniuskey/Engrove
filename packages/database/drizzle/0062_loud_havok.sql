CREATE TYPE "public"."table_permission_action" AS ENUM('visibility', 'create', 'update', 'archive');--> statement-breakpoint
CREATE TYPE "public"."table_permission_mode" AS ENUM('everyone', 'editors', 'engineers', 'administrators', 'specific', 'nobody');--> statement-breakpoint
CREATE TABLE "object_type_permission_subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"object_type_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"action" "table_permission_action" NOT NULL,
	"user_id" uuid,
	"group_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_type_permission_subjects_exactly_one_subject_check" CHECK (("object_type_permission_subjects"."user_id" is null) <> ("object_type_permission_subjects"."group_id" is null))
);
--> statement-breakpoint
ALTER TABLE "object_types" ADD COLUMN "visibility_mode" "table_permission_mode" DEFAULT 'everyone' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_types" ADD COLUMN "create_mode" "table_permission_mode" DEFAULT 'editors' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_types" ADD COLUMN "update_mode" "table_permission_mode" DEFAULT 'editors' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_types" ADD COLUMN "archive_mode" "table_permission_mode" DEFAULT 'editors' NOT NULL;--> statement-breakpoint
ALTER TABLE "object_types" ADD COLUMN "permission_row_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "object_type_permission_subjects" ADD CONSTRAINT "object_type_permission_subjects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_type_permission_subjects" ADD CONSTRAINT "object_type_permission_subjects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_type_permission_subjects" ADD CONSTRAINT "object_type_permission_subjects_project_object_fk" FOREIGN KEY ("project_id","object_type_id") REFERENCES "public"."object_types"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "object_type_permission_subjects" ADD CONSTRAINT "object_type_permission_subjects_organization_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."member_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "object_type_permission_subjects_user_key" ON "object_type_permission_subjects" USING btree ("object_type_id","action","user_id") WHERE "object_type_permission_subjects"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "object_type_permission_subjects_group_key" ON "object_type_permission_subjects" USING btree ("object_type_id","action","group_id") WHERE "object_type_permission_subjects"."group_id" is not null;--> statement-breakpoint
CREATE INDEX "object_type_permission_subjects_object_action_idx" ON "object_type_permission_subjects" USING btree ("object_type_id","action");--> statement-breakpoint
ALTER TABLE "object_types" ADD CONSTRAINT "object_types_permission_row_version_check" CHECK ("object_types"."permission_row_version" > 0);