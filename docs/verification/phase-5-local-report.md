# Community Phase 5 Verification Report

Verified on 2026-08-01 against the Charts and Dashboards acceptance criteria in the development plan.

## Automated checks

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass across the TypeScript and Python workspaces;
- `scripts/phase-5-smoke.sh` builds release containers, applies every migration to empty PostgreSQL, and executes the complete Phase 0–5 API flow;
- the smoke test creates independent exact-version XY sources and exercises every supported chart type;
- database triggers reject updates and deletes against chart revisions, chart sources, dashboard revisions, and dashboard cards.

## Acceptance evidence

The Phase 5 smoke test verifies:

- charts have stable identities, monotonic immutable revisions, safe versioned configuration, and normalized links to exact ready dataset IDs and stable column IDs;
- line and scatter charts overlay multiple independent XY datasets only when axis dimensions and display units are compatible;
- histogram and box-plot configurations operate on numeric tabular columns, while malformed, executable-looking, unsupported-version, over-deep-filter, unknown-column, and incompatible-dimension inputs fail safely;
- filter ASTs are bounded by depth, node count, group size, and membership size and persist as part of the exact chart revision;
- dashboard chart cards pin an exact chart revision, remain pinned when a chart receives a later revision, and change only through a new immutable dashboard revision;
- dashboard cards obey the 12-column bounds, unique positions, type-specific configuration, and non-overlap rules;
- KPI, specification-status, recent-dataset, overdue-task, and chart cards have explicit versioned configuration;
- chart and dashboard archive/restore operations preserve all revisions and emit audit events;
- Test & Characterization template v4 installs two missing-data-safe default charts and one seven-card engineering dashboard exactly once.

## User interface

The web application includes an ECharts chart studio for multi-source line/scatter overlays and histogram/box-plot creation. Saved charts show their exact sources and can publish explicit revisions. Dashboards render exact pinned chart revisions and engineering KPI cards, and publish immutable layout revisions. Template charts without a compatible source render a clear missing-data state instead of failing.

ECharts uses modular chart, component, and SVG-renderer registration so the product does not ship unused renderers and chart families.
