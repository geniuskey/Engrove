# Community Phase 6 Verification Report

Verified on 2026-08-01 against the Tasks and Engineering Workflow acceptance criteria.

## Automated evidence

`scripts/phase-6-smoke.sh` applies all migrations to empty PostgreSQL, builds release images, runs the complete Phase 0–6 API flow, and verifies that:

- tasks support create, read, optimistic update, archive, and restore with status, priority, organization-member assignee, and calendar due date;
- a failed specification evaluation creates one idempotent high-priority follow-up task with exact record, measurement-result, and evaluation links;
- tasks link to Sample, Issue, Test Run, measurement result, specification evaluation, and ready dataset entities only within the same project;
- a record-scoped query returns its linked tasks for record detail;
- status transitions append immutable history and emit dedicated audit events;
- database triggers reject update or deletion of task links and status history;
- archive and restore preserve the current status, full status history, and every evidence link;
- a Viewer can read tasks but receives `PERMISSION_DENIED` for creation and update;
- overdue open tasks feed the dashboard metric;
- Test & Characterization template v5 declares supported task-link types without creating a configurable Task object type.

## User interface

The project Task screen provides a four-column Kanban board, due-date calendar, lifecycle actions, status movement, and optional exact entity linking. Failed measurement evaluations expose a direct Create task action. Record detail lists active and archived linked follow-up tasks.
