ALTER TABLE "task_links" DROP CONSTRAINT IF EXISTS "task_links_entity_type_check";--> statement-breakpoint
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_entity_type_check" CHECK ("task_links"."entity_type" in ('record','sample','issue','test_run','measurement_result','specification_evaluation','dataset','external_source'));
