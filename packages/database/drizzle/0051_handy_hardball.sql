ALTER TABLE "record_views" ADD COLUMN "permission_type" text DEFAULT 'collaborative' NOT NULL;--> statement-breakpoint
ALTER TABLE "record_views" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "record_views" ADD COLUMN "lock_reason" text;--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "record_views_owner_idx" ON "record_views" USING btree ("owner_id","object_type_id","id");--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_permission_type_check" CHECK ("record_views"."permission_type" in ('collaborative', 'personal', 'locked'));--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_permission_owner_check" CHECK (("record_views"."permission_type" = 'personal') = ("record_views"."owner_id" is not null));--> statement-breakpoint
ALTER TABLE "record_views" ADD CONSTRAINT "record_views_lock_reason_check" CHECK ("record_views"."permission_type" = 'locked' or "record_views"."lock_reason" is null);