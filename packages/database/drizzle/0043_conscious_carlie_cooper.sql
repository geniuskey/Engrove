ALTER TABLE "tasks" ADD COLUMN "labels" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "tasks_labels_idx" ON "tasks" USING gin ("labels");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_labels_count_check" CHECK (cardinality("tasks"."labels") <= 12);