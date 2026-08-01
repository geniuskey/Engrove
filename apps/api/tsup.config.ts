import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/main.ts',
    'src/worker.ts',
    'src/migrate.ts',
    'src/rotate-setup.ts',
    'src/rebuild-projections.ts',
  ],
  format: ['cjs'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  noExternal: [/^@engrove\//],
});
