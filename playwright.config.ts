import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4175', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL, viewport: { width: 390, height: 844 } },
  webServer: { command: 'pnpm build && pnpm preview --port 4175 --strictPort', url: 'http://127.0.0.1:4175', reuseExistingServer: false },
});
