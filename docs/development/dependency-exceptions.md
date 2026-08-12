# Dependency exceptions

## Drizzle Kit build loader

`drizzle-kit@0.31.10`, the latest stable release checked on 2026-08-02, still depends on
`@esbuild-kit/esm-loader@2.6.5`, which in turn uses the deprecated
`@esbuild-kit/core-utils@3.3.2`. Both packages were merged into `tsx` and are used only by the
schema-generation development tool, not by a production service.

The two exact versions are listed in `pnpm-workspace.yaml` under `allowedDeprecatedVersions` so a
new or changed deprecation is not silently accepted. Remove the exception when Drizzle Kit drops
the loader. The loader's old `esbuild` dependency is overridden to patched `0.25.12`; the project
loop's full migration-generation check and PostgreSQL integration suite cover this compatibility
boundary.

Transitive security fixes that are not yet selected by their parent packages are pinned separately:

- `@nestjs/swagger > js-yaml` is pinned to `5.2.2`.
- `postcss > nanoid` is pinned to `3.3.17`.
- `tsup > esbuild` is pinned to `0.28.1`.

Run `pnpm audit --audit-level low` as part of every project loop. Do not add an audit ignore without
an explicit threat assessment, owner, and removal condition in this file.
