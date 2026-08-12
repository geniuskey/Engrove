# Record comments

Configurable records provide a lightweight comment thread for day-to-day collaboration. The grid's
record drawer keeps the table visible and switches between **Fields**, **Comments**, and **Change
history**. The full record page exposes the same comments before formal review threads, so a quick
question does not need to become an assigned review.

Comments are newest-first and paged in bounded groups of 50. A comment body contains 1–10,000
trimmed characters. Contributors, Reviewers, Engineers, Administrators, and Owners have the
`record.comment` permission; Viewers can read comments but cannot write them. A write-capable API
token with the `data` capability may use the same endpoints.

Authors may select up to 50 active organization members as mentions. Mentioned people are stored as
stable user references rather than parsed from display text, appear as chips on the comment, and
receive a `record.mentioned` notification unless they disabled mention notifications. Clicking the
notification opens the exact record and highlights the referenced comment. Self-mentions do not
create notifications. Editing a comment notifies only newly added mentions, so wording corrections
do not repeatedly alert the same people.

Only the author may edit a comment. Each edit submits the last-read `rowVersion`; concurrent edits
return `409 RECORD_COMMENT_VERSION_CONFLICT` instead of overwriting another session. The current
comment shows an edited marker, while the audit log stores the previous body, previous mention set,
and the before/after comment versions. Comments cannot be added or edited after the parent record is
archived, but the complete discussion remains readable.

Project-scoped endpoints:

- `GET /api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/comments`
- `POST /api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/comments`
- `PATCH /api/v1/workspaces/{workspaceId}/projects/{projectId}/object-types/{objectTypeId}/records/{recordId}/comments/{commentId}`

The list accepts `limit` from 1–100 and a zero-based `offset`, and returns exact `pageInfo.total`
and `hasNext` values. Comment creation and editing require browser CSRF protection. Database foreign
keys bind every comment to the exact project, table, and record; direct cross-table comment links
are rejected even when both tables belong to the same project. A database target constraint also
ensures each notification references exactly one task or one record, never both.

Deletion is deliberately unavailable because it would weaken an engineering discussion trail.
Reactions, attachments, threaded replies, and comment-triggered automations are not silently
approximated by this release; they require their own retention and delivery policies.
