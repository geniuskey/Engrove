---
description: Follow a material qualification example through real Engrove screens, from engineering data to execution.
title: Visual product tour
---

# Visual product tour

This tour uses the `force` project to review material and test data, trace external sources, and manage key dates and
follow-up work. Each screen explains **what to enter**, **what decision it supports**, and **how it connects to the
next screen**.

## Example scenario

A team is preparing an aluminum component for design freeze and production release. Test results and supplier
certificates live in different systems, while review work is distributed across several engineers.

| Managed object   | Example in this tour                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| Project          | `force`                                                                      |
| Material records | Anodized aluminum, Stainless steel 304, Carbon fiber prepreg                 |
| External sources | SharePoint certificate, LIMS test run, Jira supplier deviation               |
| Key dates        | Concept approval → Design freeze → Prototype validation → Production release |
| Execution work   | Nine items, including `Review Demo Run 001 force curve`                      |

## 1. Confirm your scope in the workspace

![Engrove workspace overview with summary indicators and four projects](/screenshots/workspace-overview.png)

_The workspace overview is the first place to confirm your organization scope and accessible projects._

A workspace is the boundary for membership and shared data. Change organizations with the workspace selector, then
enter an execution context by choosing a project. Project cards show the name without repeating an internal key.

**Try it**

1. Confirm that the current workspace is `test`.
2. Select the accessible `force` project.
3. Confirm that the project selector in the sidebar shows the same name.

## 2. Find today's decision on the project overview

![Project overview with KPIs, attention items, work progress, and shortcuts](/screenshots/project-command-center.png)

_The project overview is a command surface that leads into execution, not a separate status report._

Scan the top indicators, then begin with overdue or blocked items under `Needs attention`. Work progress summarizes
the board, while shortcuts lead to records, reviews, and key dates.

**Decision example:** when a key date is at risk, inspect linked work first. If nothing is linked, create the work
that must be completed rather than typing a subjective progress percentage.

## 3. Read unit-aware engineering data

![Material RTA grid with three material records and compact value charts](/screenshots/engineering-data-grid.png)

_The grid keeps spreadsheet density while structuring units, specification context, relationships, and history._

The `Material RTA` view compares quantitative values under shared column definitions. Compact cell charts make the
distribution scannable; open the record when you need the calculation or source evidence.

| Field            | Requirement | Example                                 |
| ---------------- | ----------- | --------------------------------------- |
| Material name    | Required    | `Anodized aluminum`                     |
| Density          | Optional    | `2.70 g/cm³`                            |
| Tensile strength | Optional    | `310 MPa`                               |
| Supplier         | Optional    | Link to an approved supplier record     |
| Certificate      | Optional    | Link external source `CERT-AL-6061-042` |

## 4. Edit without leaving the comparison context

![Material record quick view with the RTA input panel](/screenshots/record-quick-view.png)

_Quick view edits one record while preserving the comparison context of the grid._

Selecting a row opens a right-side panel. Values required for saving, such as the record name, are marked
`Required`; calculations, relationships, and notes that can be added later are marked `Optional`. Move to the full
record view only when you need wider history or relationship exploration.

**Practice:** do not force optional values during early data collection. Save a stable identifier and source link
first, then enrich the record as measurement and review proceeds.

## 5. Trace source location and version without copying it

![External source list containing SharePoint, LIMS, and Jira entries](/screenshots/external-sources.png)

_When another service owns the original, Engrove stores its URL, external identifier, revision, and verification date._

External sources do not replace the source system. They keep that system authoritative while allowing Engrove
records, work, and reviews to return to the exact item.

| Name                          | Service    | Identifier         | Revision or state | Verified   |
| ----------------------------- | ---------- | ------------------ | ----------------- | ---------- |
| Supplier material certificate | SharePoint | `CERT-AL-6061-042` | Rev C             | 2026-08-12 |
| Qualification test run        | LIMS       | `RUN-2026-0813`    | Final             | 2026-08-13 |
| Supplier deviation SUP-147    | Jira       | `SUP-147`          | Resolved          | 2026-08-11 |

Edit, replace, and delete actions use icons. Hover the pointer or move keyboard focus to an icon to read its tooltip.

## 6. Scan execution work on the board

![Kanban board with four state columns and nine work items](/screenshots/task-board.png)

_Cards show only scanning information; state changes happen through drag, keyboard actions, or the context menu._

Use the board to read flow and bottlenecks. Repeated state dropdowns and overflow buttons do not compete with titles,
owners, priority, and column workload.

**Try it:** select `Review Demo Run 001 force curve`. Move the card if only its state changes; open details when
you need to inspect its description or evidence.

## 7. Edit context and execution in work details

![FORCE-5 work item detail open over the board](/screenshots/task-detail.png)

_Like Jira, selecting a card opens editable details without navigating away from the board._

Details distinguish the required title and state from optional description, priority, owner, and due date. Link the
record, specification evaluation, and external source so the assignee can understand why the work exists.

A useful engineering work item can begin with three statements:

1. **Observation:** an unexpected peak appears in the Demo Run 001 force curve.
2. **Decision rule:** review it against the approved method and current specification revision.
3. **Done condition:** record the cause and link a valid result or retest plan to the record.

## 8. Place date-critical events on one axis

![Four project dates and states connected on a single timeline](/screenshots/key-date-timeline.png)

_Key dates show the order and risk of decisions rather than drawing task durations like a Gantt chart._

The example runs from `Concept approval` to `Production release`. `Design freeze` has one linked work item and shows
`0/1`. Once that work is complete, the execution context updates without a manually maintained percentage.

| Key date             | Date       | State    | Meaning                                            |
| -------------------- | ---------- | -------- | -------------------------------------------------- |
| Concept approval     | 2026-07-15 | Complete | Requirements and architecture approved             |
| Design freeze        | 2026-08-20 | Active   | Release drawings and freeze the test configuration |
| Prototype validation | 2026-09-10 | At risk  | Critical test findings still need closure          |
| Production release   | 2026-10-01 | Planned  | Approve production after validating evidence       |

## 9. Summarize on a dashboard and return to evidence

![Dashboard with total samples, pass rate, failed evaluations, and recent datasets](/screenshots/dashboard-canvas.png)

_A dashboard is an exploration surface linked to saved views and source records, not a detached conclusion._

Total samples, pass rate, failed evaluations, and recent datasets provide a concise status view. When a value looks
wrong, drill into the filtered records and create a review or follow-up work item if necessary.

## The complete flow

The important result is the connection, not the number of screens.

```text
Workspace → Project → Record → External source
                         ↓
                    Review/evaluation → Work → Key date
                         ↑                       ↓
                         └────── Dashboard ──────┘
```

Next, [run Engrove locally](/en/guide/getting-started) or study the
[ownership and relationship model](/en/guide/concepts).
