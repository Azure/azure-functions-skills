import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: process.platform === 'win32' ? 30_000 : 10_000,
  },
});
