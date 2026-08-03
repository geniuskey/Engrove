ALTER TABLE "object_types" ADD COLUMN "public_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "public_id" text;--> statement-breakpoint
-- UUIDv7 values created together share a long timestamp prefix, so hash the complete UUID before shortening it.
UPDATE "object_types" SET "public_id" = 'm' || left(md5("id"::text), 14);--> statement-breakpoint
UPDATE "projects" SET "public_id" = 'p' || left(md5("id"::text), 14);--> statement-breakpoint
ALTER TABLE "object_types" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "object_types_public_id_key" ON "object_types" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_public_id_key" ON "projects" USING btree ("public_id");
