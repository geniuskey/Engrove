ALTER TABLE "record_comments" DROP CONSTRAINT "record_comments_project_record_fk";
--> statement-breakpoint
CREATE UNIQUE INDEX "records_project_object_id_key" ON "records" USING btree ("project_id","object_type_id","id");--> statement-breakpoint
ALTER TABLE "record_comments" ADD CONSTRAINT "record_comments_project_record_fk" FOREIGN KEY ("project_id","object_type_id","record_id") REFERENCES "public"."records"("project_id","object_type_id","id") ON DELETE restrict ON UPDATE no action;
