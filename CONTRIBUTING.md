# Contributing to Engrove

Engrove Community accepts changes under the repository's AGPL-3.0-only license. Keep every change independently useful to Community; do not add dormant commercial paths, license gates, or speculative extension packages.

## Development workflow

1. Install the pinned Node, pnpm, Python, and uv versions from the repository files.
2. Copy `.env.example` to `.env` and use only local development credentials.
3. Run `pnpm install --frozen-lockfile` and `uv sync --project apps/worker-python --locked`.
4. Make a focused change with tests and an ADR when it changes an accepted architectural decision.
5. Run `pnpm format`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm verify:community`.

Generated Drizzle SQL is reviewed like application code. Never use schema push in production. Security-sensitive reports should not be opened publicly until maintainers have coordinated a disclosure path.

Commit messages should explain intent. Pull requests should list verification performed, migration and deployment effects, and user-visible behavior.
