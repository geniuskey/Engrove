---
description: Run Engrove Community locally and explore its core user flow.
title: Quick start
---

# Quick start

This guide runs Engrove Community in a development environment and gives you the shortest useful product tour.

## Prerequisites

- Node.js 24.13.0 and pnpm 10.29.2
- Python 3.13.12 and uv 0.10.0
- Docker Engine and Docker Compose v2

Use the versions pinned by the repository. Other Node versions produce an engine warning and are not accepted as
production validation evidence.

## Run locally

```bash
git clone https://github.com/geniuskey/Engrove.git
cd Engrove
cp .env.example .env
corepack enable
pnpm install --frozen-lockfile
uv sync --project apps/worker-python --locked
docker compose -f deploy/compose/compose.yaml up -d --build
```

Open `http://localhost:4173` and complete first-run setup with the development setup token from `.env`. Never use
the example credentials outside a local development environment.

## Five places to explore first

### 1. Workspace overview

See your groups, accessible projects, recent work, key dates, and data. A workspace is the boundary for team
membership and shared data.

![Workspace overview with project cards and summary indicators](/screenshots/workspace-overview.png)

_The workspace selector changes the organization boundary; the project selector changes the current work context._

### 2. Data library

Open structures shared across projects, such as samples, equipment, and materials. Switch views and open a record
to inspect measurements, specifications, evidence, comments, and linked work.

### 3. Project key dates

Engrove uses a single target date for events where the date itself matters. Link work items and Engrove derives
completion context from the completed linked work instead of asking for a manual percentage.

### 4. Work

Switch between board, list, and calendar views. Select a card to edit status, owner, priority, subtasks, blockers,
work logs, comments, and evidence in a detail panel.

### 5. Dashboards and reviews

Build charts from saved data views and place them on a dashboard. Request a record review and observe how approval
or change requests become part of history and notifications.

![Test and characterization project dashboard](/screenshots/dashboard-canvas.png)

_Dashboard widgets reuse saved data views, keeping summary filters aligned with source records._

## Ten-minute example: material qualification

| Step | Example                                      | What to verify                                         |
| ---- | -------------------------------------------- | ------------------------------------------------------ |
| 1    | Create a `Material qualification` project    | Workspace and project responsibilities are distinct.   |
| 2    | Add an `Al 6061-T6` material record          | Units and required or optional fields are explicit.    |
| 3    | Add a certificate URL and `CERT-AL-6061-042` | You can trace an external source without copying it.   |
| 4    | Add `Design freeze` on `2026-08-20`          | One date is enough; no duplicate start date is needed. |
| 5    | Add `Review test curve`                      | You can move from data to execution and back.          |
| 6    | Review pass rate and recent records          | Every summary can lead back to evidence.               |

Continue with the [visual product tour](/en/guide/product-tour) for exact screens and input examples.

## API and validation

Local OpenAPI documentation is available at `http://localhost:3000/api/docs`. Create a token with only the scopes
and lifetime you need, then store it immediately because it is displayed once.

Run the complete repository quality gate with:

```bash
bash scripts/project-loop.sh
```

It checks formatting, linting, types, unit and integration tests, browser accessibility, production readiness,
vulnerabilities, builds, and bundle budgets.

## Read next

- [Visual product tour](/en/guide/product-tour)
- [Structure and core concepts](/en/guide/concepts)
- [Key dates and work management](/en/guide/work-management)
- [API and operations](/en/guide/api-and-operations)
