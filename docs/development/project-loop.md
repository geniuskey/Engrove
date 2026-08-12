# Engrove project loop

The project loop is a repeatable review, improvement, and verification cycle. Run it from the
repository root after each coherent change:

```bash
bash scripts/project-loop.sh
```

Install the pinned Chromium release once before the first local browser run:

```bash
pnpm --filter @engrove/web exec playwright install chromium
```

The script reads the exact runtime from `.node-version`. If the current shell uses another Node
version, it runs pnpm through that pinned Node release without changing the user's global Node
installation. The first bootstrap may need network access; subsequent runs use pnpm's cache.

Each cycle has four stages:

1. **Review:** inspect authorization and scope boundaries, data integrity and migrations, UI query
   completeness, accessibility, performance, operations, and test coverage.
2. **Prioritize:** fix correctness, security, data-loss, and compatibility findings before
   maintainability or cosmetic work.
3. **Improve:** make the smallest coherent change, including regression coverage and an ADR when
   ownership or compatibility semantics change.
4. **Verify:** run the project loop. A cycle is not complete while checks fail, engine warnings or
   oversized bundle warnings remain, the ephemeral PostgreSQL integration suite or browser E2E
   suite fails, or `git diff --check` reports malformed patches.

The browser suite includes an automated axe gate over the workspace overview, configurable-data
grid, task board, record quick view, and task detail in both light and dark themes. It evaluates WCAG
2.0, 2.1, and 2.2 A/AA rules, including text contrast and 24-pixel target sizing. A clean scan does
not replace keyboard and screen-reader review for new interaction patterns, but a detected violation
is a release failure rather than a deferred cosmetic issue.

The production web build has hard budgets, checked by `pnpm bundle:check`: each JavaScript chunk
must stay at or below 450 KiB, all JavaScript chunks together at or below 1,737 KiB, and each CSS
asset at or below 111.25 KiB. The August 2026 measured JavaScript total is 1,735.7 KiB and includes
the workspace command center, configurable data surface, task collaboration and automation, bounded searchable
data and key-date catalogs, paged notification, record history and review inboxes, key-date/task
traceability, retry-safe creation flows, visible least-privilege API-token capability selection,
record comments with author-only optimistic edits and preference-aware mention notifications, and a
separate lazy public saved-view surface with password, expiry, and CSV controls. It also includes
project-wide task-flow aging, throughput, median/P85 cycle-time insights, and direct bottleneck
drill-down. Daily lifecycle-aware cumulative flow uses a native accessible SVG and adds no chart
dependency; the companion created-versus-completed trend uses the same approach and keeps explicit
reopen/archive semantics, plus guarded session-expiry recovery that returns users to the exact
protected route after local or OIDC reauthentication. An application-wide render boundary now
contains component and lazy-chunk failures, offers the appropriate recovery action, and reports a
privacy-bounded correlation UUID without sending messages or route parameters. The largest
JavaScript chunk remains below 450 KiB. Editable task duplication adds explicit copy-scope guidance
and an atomic source relationship without enlarging the initial chunk past that limit. Atomic
failed-evaluation follow-up feedback adds a compact tooltip action and durable created-task link.
Controlled measurement field/unit drafts add safe multi-field continuous entry while keeping the
measured JavaScript total at 1,653.9 KiB. Human-readable, bounded user/file/dataset reference
selection replaces raw UUID entry in configurable records and brings the measured total to 1,655.9
KiB without changing the 450 KiB per-chunk limit or adding a dependency. Page-level reference-label
hydration and removal of unsupported resource-field controls bring it to 1,656.4 KiB; schema-label
rendering for select fields brings it to 1,656.6 KiB; human-readable task evidence and exact record
drill-downs bring it to 1,657.0 KiB. Compact localized field-type icons and on-demand record-ID copy
controls then remove redundant English-only metadata and leave the measured total at 1,656.5 KiB.
Table-local typed-schema discovery completes the metadata-to-data API quickstart and brings it to
1,656.6 KiB. Compact localized field-type icons replace repeated Grid header type labels and bring
the measured total to 1,656.8 KiB. Subsequent task collaboration, CSV onboarding, table/resource
access controls, and the lazy resource-access editor bring the reviewed total to 1,728.3 KiB. A
queued application action dialog then replaces browser-native confirmation and short-text prompts
with focus trapping, keyboard dismissal, focus restoration, localized labels, and destructive-action
emphasis, bringing the reviewed total to 1,735.7 KiB while every chunk stays below 450 KiB.
Theme-safe AA contrast tokens and 24-pixel Grid targets bring the
shared CSS asset to 111.2 KiB; the accessibility scanner is a development-only dependency and adds
no production JavaScript.
Raise a limit only with an explanation of the user-visible tradeoff; prefer lazy loading or splitting
a dependency first.

The loop also fails on any published dependency vulnerability. Deliberate deprecation exceptions
and their removal conditions are recorded in `dependency-exceptions.md`.

Continue with another review after verification. Stop only when there are no unresolved critical or
high-severity findings in the reviewed scope and all automated gates pass. Record deferred lower
severity findings in the relevant product plan or ADR rather than silently dropping them.
