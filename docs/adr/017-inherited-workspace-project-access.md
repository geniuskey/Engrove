# ADR-017: Inherited workspace and project access

- Status: Accepted
- Date: 2026-08-11
- Extends: [Application-enforced project isolation](010-application-enforced-project-isolation-without-postgresql-rls.md)

## Context

An organization role describes what a person may do, but it must not imply that the person may see
every team's workspace and project. The former model made every organization member a reader of
every workspace and project. That differs from Jira's project Browse boundary and NocoDB's separate
workspace and base access, and it leaks names and aggregates through navigation, search, reports,
personal work, and notifications even when individual tasks or tables are restricted.

## Decision

Add two inherited discovery boundaries. A workspace is either organization-visible or restricted.
A project is either visible to everyone who can enter its workspace or restricted further. Restricted
resources admit owners, administrators, the creator, explicitly selected active members, and members
of selected active organization groups. A project can never widen its parent workspace.

The database exposes reviewed `workspace_visible_to` and `project_visible_to` predicates. The HTTP
authorization entry point evaluates them for every route containing a workspace or project, while
workspace-wide catalogs and projections apply the predicates directly. Unauthorized resources use
the same not-found response as absent resources.

## Consequences

- Existing installations retain behavior because workspaces default to organization visibility and
  projects default to inherited workspace visibility.
- Creation can select restricted visibility atomically; there is no briefly public resource.
- Complete policy replacement uses a dedicated optimistic access version and validates at most 100
  active members and 100 active groups.
- Restricting access removes unauthorized task watchers and stored notifications. Search, overview,
  key dates, My Work, task visibility, due-date reconciliation, navigation options, and API tokens
  resolve against the same inherited boundary.
- Owners and administrators always retain recovery access. The creator also retains access so a
  policy cannot orphan its resource.
- Organization capabilities remain separate from resource discovery. Only owners and administrators
  may manage these policies in the current role model.

## Rejected alternatives

- Organization-role-only visibility, because it cannot isolate teams or external collaborators.
- UI-only filtering, because direct APIs and aggregate projections would still disclose resources.
- Project-only restrictions, because workspace names, shared data, and project catalogs still need a
  parent boundary.
- Independent workspace and project grants, because a child must never widen access beyond its
  parent.
- PostgreSQL row-level security, because Engrove still follows ADR-010's explicit application and
  repository scoping model for request and worker behavior.

## Verification constraints

- Integration tests cover default inheritance, direct workspace grants, group project grants,
  fail-closed direct lookup, filtered catalogs, and workspace search.
- OpenAPI publishes create-time visibility and GET/PATCH policy contracts.
- Any new workspace aggregate or global notification projection must include the shared predicates.
