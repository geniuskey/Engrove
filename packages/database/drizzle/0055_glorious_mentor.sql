CREATE TABLE "public_form_submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"share_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"idempotency_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"network_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "public_form_submissions_hashes_check" CHECK (length("public_form_submissions"."idempotency_hash") = 64 and length("public_form_submissions"."request_hash") = 64 and length("public_form_submissions"."network_fingerprint") = 64)
);
--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "records" ALTER COLUMN "updated_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "public_form_submissions" ADD CONSTRAINT "public_form_submissions_share_id_record_view_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."record_view_shares"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_form_submissions" ADD CONSTRAINT "public_form_submissions_record_id_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "public_form_submissions_share_idempotency_key" ON "public_form_submissions" USING btree ("share_id","idempotency_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "public_form_submissions_record_key" ON "public_form_submissions" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "public_form_submissions_share_created_idx" ON "public_form_submissions" USING btree ("share_id","created_at","id");