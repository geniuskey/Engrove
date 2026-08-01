CREATE TABLE "record_dataset_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"dataset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_file_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "record_dataset_references" ADD CONSTRAINT "record_dataset_references_project_record_fk" FOREIGN KEY ("project_id","record_id") REFERENCES "public"."records"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_dataset_references" ADD CONSTRAINT "record_dataset_references_project_field_fk" FOREIGN KEY ("project_id","field_id") REFERENCES "public"."field_definitions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_dataset_references" ADD CONSTRAINT "record_dataset_references_project_dataset_fk" FOREIGN KEY ("project_id","dataset_id") REFERENCES "public"."datasets"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_file_references" ADD CONSTRAINT "record_file_references_project_record_fk" FOREIGN KEY ("project_id","record_id") REFERENCES "public"."records"("project_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_file_references" ADD CONSTRAINT "record_file_references_project_field_fk" FOREIGN KEY ("project_id","field_id") REFERENCES "public"."field_definitions"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_file_references" ADD CONSTRAINT "record_file_references_project_file_fk" FOREIGN KEY ("project_id","file_id") REFERENCES "public"."file_objects"("project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "record_dataset_references_record_field_key" ON "record_dataset_references" USING btree ("record_id","field_id");--> statement-breakpoint
CREATE INDEX "record_dataset_references_dataset_idx" ON "record_dataset_references" USING btree ("dataset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "record_file_references_record_field_key" ON "record_file_references" USING btree ("record_id","field_id");--> statement-breakpoint
CREATE INDEX "record_file_references_file_idx" ON "record_file_references" USING btree ("file_id");