---
description: Understand Engrove workspaces, projects, data, evidence, and permission boundaries.
title: Structure and core concepts
---

# Structure and core concepts

Engrove narrows its information structure from **organization → workspace → project**. Data can remain shared at
workspace level or receive project context when needed.

## Information hierarchy

| Level        | Responsibility                     | Representative elements                                                     |
| ------------ | ---------------------------------- | --------------------------------------------------------------------------- |
| Organization | Users and global roles             | Members, groups, Owner, Admin, Engineer, Contributor, Reviewer, Viewer      |
| Workspace    | Team and shared-data boundary      | Data library, accessible projects, personal work                            |
| Project      | Execution boundary for one goal    | Key dates, work, reviews, external sources, dashboards                      |
| Record       | Context for an engineering subject | Properties, relationships, measurements, evaluations, files, comments, work |

## Data is not a project subfolder

Samples, equipment, and suppliers are reused across projects. The data library therefore belongs to the workspace,
while individual records may receive a project context when necessary.

This satisfies two requirements at the same time:

- The same equipment or sample is not copied into every project.
- A project screen defaults to data relevant to that project.

Table access policies can narrow a global role without widening it. Policies can identify members, groups, or a
minimum role. A hidden table remains hidden through direct URLs and the API.

## A project is execution context

The project selector changes the current context, and the sidebar shows only the actions available in that project.
Users can switch directly from the workspace overview instead of passing through a repeated project list page.

Project elements have distinct jobs:

- **Key dates:** sequential events where one date matters
- **Work:** assignable execution units with state
- **Reviews:** approval or change-request conversations around records or decisions
- **External sources:** URLs, versions, and provider metadata for originals stored elsewhere
- **Dashboards:** compositions of revision-pinned data views and charts

## Sources and derived results

Files and datasets are different concepts.

1. A source file preserves its checksum and exact version.
2. Processing produces a new dataset or artifact without modifying the source.
3. Charts, evaluations, and work reference the exact version used.
4. When another system owns the source, Engrove can link only a stable URL and traceability metadata.

## Measurements and specifications

A measurement is a combination of value, unit, physical dimension, and observation time—not a plain number.
Specifications are revisioned, and each evaluation is pinned to the revision used. A specification change therefore
does not rewrite the evidence behind a past decision.

## Archive and deletion

Operational data is not physically removed immediately. Regular users archive and restore items while references
and history remain intact. Optimistic concurrency based on row versions prevents a stale screen from silently
overwriting a newer change.

Continue with [key dates and work management](/en/guide/work-management).
