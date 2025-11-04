import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/integration',
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:8080',
    trace: 'on-first-retry',
  },
});
