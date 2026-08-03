ALTER TABLE "object_types" DROP CONSTRAINT "object_types_public_id_check";--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "public_id" text;--> statement-breakpoint
UPDATE "workspaces" SET "public_id" = 'w' || left(md5("id"::text), 14);--> statement-breakpoint
UPDATE "object_types" SET "public_id" = 't' || substring("public_id" from 2);--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_public_id_key" ON "workspaces" USING btree ("public_id");--> statement-breakpoint
ALTER TABLE "object_types" ADD CONSTRAINT "object_types_public_id_check" CHECK ("object_types"."public_id" ~ '^t[0-9a-z]{14}$');--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_public_id_check" CHECK ("workspaces"."public_id" ~ '^w[0-9a-z]{14}$');
