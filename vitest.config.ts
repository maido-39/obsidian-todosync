import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript source so tests run without a
// prior build (esbuild transpiles on the fly). Production consumers still use
// the `dist` output via each package's `exports` map.
const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      '@todomd/shared-types': resolve(root, 'packages/shared-types/src/index.ts'),
      '@todomd/core': resolve(root, 'packages/core/src/index.ts'),
      '@todomd/sync-engine': resolve(root, 'packages/sync-engine/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
