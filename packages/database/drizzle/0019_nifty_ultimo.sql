ALTER TABLE "record_views" ADD COLUMN "public_id" text;--> statement-breakpoint
UPDATE "record_views" SET "public_id" = 'v' || left(md5("id"::text), 14);--> statement-breakpoint
ALTER TABLE "record_views" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "record_views_public_id_key" ON "record_views" USING btree ("public_id");--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_public_id_check" CHECK ("record_views"."public_id" ~ '^v[0-9a-z]{14}$');
