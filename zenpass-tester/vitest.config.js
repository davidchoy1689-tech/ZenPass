// ZenPass Vitest Configuration
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
