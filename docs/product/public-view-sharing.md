# Public saved-view sharing

Engrove can publish a persisted Grid, Gallery, Kanban, Calendar, or Form view to people who do not
have an account. Data views are live and read-only: saved field visibility, filters, and layout
continue to follow the owner-managed view, while a visitor's search, filters, sorting, and paging
remain temporary. Form views are write-only intake links that create records through the same field
validation, derived-value, audit, and webhook transaction used inside Engrove.

## Owner workflow

1. Open a saved view and select the **Share view** icon.
2. Optionally require a password and choose an expiry. For read-only views, explicitly enable CSV
   download when needed; form links never expose download.
3. Enable the link and copy the full URL immediately. Engrove cannot display it again.
4. Return to the same panel to change settings, rotate the URL, review access count and last access,
   or revoke it.

Creating a new link when one is already active rotates it. The previous URL stops working
immediately. Password, expiry, download, rotation, and revocation controls are kept together so the
owner can assess the complete exposure boundary before publishing.

Only Engineers, Admins, and Owners receive `view.share`. Contributors can continue managing saved
view content according to its collaborative or personal permissions, but cannot publish it outside
the organization. API tokens cannot create, update, rotate, or revoke shares.

## Visitor contract

The public page has no editing controls and does not require an Engrove session. Password-protected
links reveal no metadata until unlocked. A successful unlock grants a short-lived, link-specific
access token. Visitors can explore only fields made visible by the saved view; their changes never
alter the shared definition.

CSV download is an explicit owner choice and is limited to 10,000 records. File and dataset
references, internal record identifiers, relation identifiers, and user identifiers are not
included in public output. Public record identifiers are derived separately for each share.

## Public form contract

Only visible scalar, select, quantity, and range fields may be published in a public form. User,
relation, file, dataset, measurement, calculated, and structured-data fields can expose internal
identifiers or require privileged storage/evaluation workflows, so share creation fails with the
exact incompatible field until the owner removes it. Existing form validation also prevents hiding
a required field that has no default.

The public page marks every field as required or optional and never exposes existing records. Every
submission requires an 8–200 character idempotency key; a safe retry returns the original record,
while reusing a key with different content returns a conflict. A hidden bot-trap field must remain
empty and submissions are limited to 20 per link and privacy-preserving client fingerprint per hour.
Raw client addresses are not stored.

Anonymous submissions deliberately leave `records.created_by` and `records.updated_by` empty rather
than attributing external input to the link owner. `public_form_submissions` retains the immutable
share-to-record provenance, request hash, idempotency digest, keyed network fingerprint, and time.
The audit event uses `record.public_form_submitted` with no actor, and the ordinary `record.created`
webhook includes `source: public_form`, the share/view identifiers, and a null actor. Only the first
successful attempt increments the share's submission count.

## Security operations

- Treat the URL as a bearer credential, even when a password is also enabled.
- Prefer expiry for vendor reviews, design gates, and other time-bounded collaboration.
- Rotate a link if it may have been forwarded beyond the intended audience.
- Revoke it when the external review or handoff ends.
- Do not collect share URLs in analytics, support screenshots, proxy logs, or browser telemetry.
- Keep CSV disabled when live viewing is sufficient.

Engrove stores only share-token and unlock-token digests. Public responses use `no-store`, the web
application sends no referrer, HTTP logs redact the public token path segment, unlock and submission
attempts are independently rate-limited per link and privacy-preserving client fingerprint, and
share lifecycle changes are included in the organization audit log.
