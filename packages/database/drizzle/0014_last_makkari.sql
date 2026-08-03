CREATE TABLE "member_group_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"color" text DEFAULT 'sky' NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_groups_organization_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "member_groups_color_check" CHECK ("member_groups"."color" in ('slate', 'sky', 'emerald', 'amber', 'rose', 'violet'))
);
--> statement-breakpoint
ALTER TABLE "member_group_memberships" ADD CONSTRAINT "member_group_memberships_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_group_memberships" ADD CONSTRAINT "member_group_memberships_organization_group_fk" FOREIGN KEY ("organization_id","group_id") REFERENCES "public"."member_groups"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_group_memberships" ADD CONSTRAINT "member_group_memberships_organization_user_fk" FOREIGN KEY ("organization_id","user_id") REFERENCES "public"."memberships"("organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_groups" ADD CONSTRAINT "member_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_groups" ADD CONSTRAINT "member_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_groups" ADD CONSTRAINT "member_groups_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_group_memberships_group_user_key" ON "member_group_memberships" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "member_group_memberships_organization_user_idx" ON "member_group_memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_groups_active_organization_name_key" ON "member_groups" USING btree ("organization_id",lower("name")) WHERE "member_groups"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "member_groups_organization_idx" ON "member_groups" USING btree ("organization_id","name","id");