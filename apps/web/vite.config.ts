import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'echarts',
              test: /node_modules[\\/]echarts[\\/]/,
              priority: 20,
              includeDependenciesRecursively: true,
            },
            {
              name: 'zrender',
              test: /node_modules[\\/]zrender[\\/]/,
              priority: 30,
              includeDependenciesRecursively: true,
            },
          ],
        },
      },
    },
  },
  server: { port: 4173 },
  preview: { host: '0.0.0.0', port: 4173 },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
