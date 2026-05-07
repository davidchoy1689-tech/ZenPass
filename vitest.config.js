// ZenPass Vitest Configuration
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['node_modules', 'tests/e2e', 'zenpass-tester'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
