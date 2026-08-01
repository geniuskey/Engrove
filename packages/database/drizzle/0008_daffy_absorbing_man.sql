CREATE TABLE "maintenance_state" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"mode" text NOT NULL,
	"lease_owner" text NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_state_singleton" CHECK ("maintenance_state"."singleton" = true),
	CONSTRAINT "maintenance_state_mode" CHECK ("maintenance_state"."mode" in ('backup','restore'))
);
