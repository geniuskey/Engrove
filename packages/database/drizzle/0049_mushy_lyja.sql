ALTER TABLE "api_tokens" ADD COLUMN "scopes" text[];--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_scopes_check" CHECK ("api_tokens"."scopes" is null or (
        cardinality("api_tokens"."scopes") between 1 and 6 and
        "api_tokens"."scopes" <@ array['workspace','project','data','tasks','schedule','reviews']::text[]
      ));