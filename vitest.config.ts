import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/global-setup.ts'],
    testTimeout: process.platform === 'win32' ? 30_000 : 5_000,
  },
});
