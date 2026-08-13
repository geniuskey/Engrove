---
description: Learn what Engrove solves and how it connects data, projects, and execution work.
title: Introducing Engrove
---

# Introducing Engrove

**Engrove is a self-hosted workspace that connects engineering data and project execution.**

It combines the flexibility of configurable database tables, Jira-style execution work, unit-aware test and
measurement data, specification evaluation, and traceable source evidence.

![Engrove project overview connecting work, data, key dates, and reviews](/screenshots/project-command-center.png)

_The project overview is one starting point for dates, execution work, engineering data, and reviews._

## The problem Engrove solves

| Information                         | Common home                          | Operational problem                                          |
| ----------------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| Samples, equipment, test conditions | Excel, shared documents              | Structure and terminology vary by author.                    |
| Source files and result data        | NAS, S3, instrument PCs              | It is hard to identify the exact source behind a result.     |
| Specifications and evaluations      | Documents, formulas, personal sheets | The specification revision used for an old decision is lost. |
| Key dates                           | Calendars, presentations             | Dates are disconnected from execution work, hiding risk.     |
| Follow-up work                      | Jira, chat, email                    | The task remains, but its engineering evidence disappears.   |

Engrove does not try to place everything on one screen. It connects stable identifiers and immutable history so a
record can find its file, measurement, evaluation, and work item—and a work item can return to its exact evidence.

## Three product pillars

### 1. Data library

Workspace-shared engineering tables model samples, equipment, materials, suppliers, and test methods.

- Typed fields, relationships, and required or optional rules
- Grid, gallery, Kanban, calendar, and saved views
- Search, filter, sort, grouping, summaries, and CSV interchange
- Table-level access policies for members, groups, and roles
- Comments, mentions, review requests, and change history

### 2. Projects

A project provides the execution context around shared data.

- **Key dates** with one target date and a single-axis timeline
- Board, list, calendar, subtasks, blockers, and ranking for **work items**
- Owners, comments, subscriptions, attachments, URLs, and work logs
- Data-linked reviews with approval or change requests
- Revision-pinned charts and dashboards

### 3. Traceability and operations

Engrove keeps the origin and decision chain explicit.

- Measurement fields with physical dimensions and allowed units
- Immutable measurement and calibration history
- Specification revisions and evaluations pinned to the revision used
- Checksummed file and dataset versions
- Actor- and target-aware audit events
- OIDC, granular permissions, backup and restore, and operational metrics

## Where Engrove sits between NocoDB and Jira

| Perspective                            | General database       | General issue tracker | Engrove                          |
| -------------------------------------- | ---------------------- | --------------------- | -------------------------------- |
| Flexible tables and views              | Strong                 | Limited               | Strong                           |
| Workflow and priority                  | Limited                | Strong                | Strong                           |
| Physical units and measurement history | Generic fields         | Out of scope          | First-class concepts             |
| Reproducible specification evaluation  | Custom design required | Out of scope          | Native traceability model        |
| Work linked to exact data evidence     | Link-oriented          | Link-oriented         | Entity- and revision-level links |
| Self-hosting and API                   | Product-dependent      | Product-dependent     | Community baseline               |

Engrove is less “Jira with tables” and more an **engineering operations space that preserves evidence from data to
decision and execution**.

## The product on screen

### Structured engineering data

![Material RTA grid with units and result context](/screenshots/engineering-data-grid.png)

_Keep unit-aware values, evaluations, relationships, and source evidence on the same record._

### Date-centered project structure

![Four key dates arranged on one project timeline](/screenshots/key-date-timeline.png)

_Read decision dates on one axis. Progress comes from linked work completion, not a manually entered percentage._

### Editable execution details

![Work item detail panel open over a Kanban board](/screenshots/task-detail.png)

_Cards stay easy to scan; selecting one opens an editable detail panel without losing the board context._

## Who it is for

- Test, validation, and reliability engineers
- Process, quality, equipment, and materials engineers
- Project leads and engineering managers
- Internal platform, IT, security, and quality-system owners

Engrove is especially useful for teams of 10–100 people that depend on spreadsheets and shared drives but need
standard data structures and private-network or on-premises deployment.

Continue with the [visual product tour](/en/guide/product-tour), run the app with the
[quick start](/en/guide/getting-started), or study the [structure and core concepts](/en/guide/concepts).
