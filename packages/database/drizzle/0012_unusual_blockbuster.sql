ALTER TABLE "projects" ADD COLUMN "system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "context_project_id" uuid;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_context_project_id_projects_id_fk" FOREIGN KEY ("context_project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_system_key" ON "projects" USING btree ("workspace_id") WHERE "projects"."system" = true;--> statement-breakpoint
CREATE INDEX "records_context_project_idx" ON "records" USING btree ("context_project_id","updated_at","id");