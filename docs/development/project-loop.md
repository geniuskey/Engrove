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

The production web build has hard budgets, checked by `pnpm bundle:check`: each JavaScript chunk
must stay at or below 450 KiB, all JavaScript chunks together at or below 1,100 KiB, and each CSS
asset at or below 64 KiB. Raise a limit only with an explanation of the user-visible tradeoff;
prefer lazy loading or splitting a dependency first.

The loop also fails on any published dependency vulnerability. Deliberate deprecation exceptions
and their removal conditions are recorded in `dependency-exceptions.md`.

Continue with another review after verification. Stop only when there are no unresolved critical or
high-severity findings in the reviewed scope and all automated gates pass. Record deferred lower
severity findings in the relevant product plan or ADR rather than silently dropping them.
