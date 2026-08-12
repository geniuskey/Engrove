DROP INDEX "task_links_task_entity_key";--> statement-breakpoint
CREATE INDEX "task_links_task_entity_idx" ON "task_links" USING btree ("task_id","entity_type","entity_id");