---
description: Use date-centered project events and Jira-style execution work together.
title: Key dates and work management
---

# Key dates and work management

Engrove separates a project's time structure from its execution work. This keeps date semantics clear and removes
the burden of manually maintaining progress percentages.

## Key dates are date-centered

A key date is not a work package with a start and end date. It is a **project event where the date itself matters**.

Examples include design freeze, prototype arrival, test completion, customer review, and production approval.
These events often form a sequence, making the previous key date an implicit start boundary. Engrove therefore uses
one target date plus status, description, owner, and linked work.

Progress is not entered manually. Engrove shows completed linked work over total linked work, keeping schedule
context aligned with execution data.

![Concept approval, design freeze, prototype validation, and production release on one timeline](/screenshots/key-date-timeline.png)

_`Design freeze` has one linked work item and displays `0/1`, derived from work state rather than a typed percent._

### Key-date example

| Field       | Requirement | Example                                                      |
| ----------- | ----------- | ------------------------------------------------------------ |
| Name        | Required    | `Prototype validation`                                       |
| Target date | Required    | `2026-09-10`                                                 |
| Status      | Required    | At risk                                                      |
| Description | Optional    | Close critical test findings before supplier tooling starts. |
| Linked work | Optional    | Test-curve review, deviation approval                        |

Do not enter a start date or manual progress. Read the interval between two target dates and derive execution status
from linked work.

## Work items are execution units

Work follows familiar Jira patterns while treating engineering evidence as first-class information.

- Project-specific states and allowed transitions
- Kanban, dense list, and calendar views
- Owner, priority, due date, labels, and saved filters
- Subtasks and derived completion context
- Blocking, predecessor, and related-work relationships
- Original estimate, remaining time, and per-author work logs
- Comments, mentions, subscriptions, attachments, and URLs
- Exact links to records, measurements, evaluations, files, and datasets

Selecting a card opens an editable detail panel. Cards do not repeat state dropdowns or overflow menus, keeping the
board readable; movement happens through drag and drop, keyboard actions, or the context menu.

![Kanban board with To do, In progress, Review, and Done columns](/screenshots/task-board.png)

_Cards retain only the identifier, title, owner, priority, and other information needed for scanning._

![Selected work item open in a detail panel](/screenshots/task-detail.png)

_Edit title, description, state, priority, ownership, and optional context in the panel. Required and optional labels
make save conditions explicit._

### Work-item example

For `Review Demo Run 001 force curve`, create the item with only a title and state, then add context as the work
becomes actionable.

- Required: title and state
- Optional: description, priority, owner, due date, labels, estimate
- Evidence: test record, evaluation result, source file, or external URL
- Relationships: parent, child, predecessor, blocker, and related work

## Connect work to data

Creating follow-up work from a failed specification evaluation links the record and field, measurement and unit,
specification revision and decision, work item, and audit event in one transaction. The assignee can return to the
exact evidence instead of reconstructing the cause from the title.

## Reviews and personal work

Not every discussion needs a work item. A record review provides assigned reviewers, conversation, approval or
change request, and resolution history. Personal work collects assigned work and requested reviews across projects.

Continue with the [visual product tour](/en/guide/product-tour) or the [API and operations guide](/en/guide/api-and-operations).
