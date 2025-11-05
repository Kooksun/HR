import { defineConfig } from '@playwright/test';

export default defineConfig({
  projects: [
    {
      name: 'integration',
      testDir: './tests/integration',
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
    },
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:8080',
    trace: 'on-first-retry',
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev',
        port: 8080,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
