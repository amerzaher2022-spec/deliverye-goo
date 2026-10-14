import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3200);
const chromiumPath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    launchOptions: { executablePath: chromiumPath, args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 820 } }, testMatch: /demo\.spec/ },
    { name: 'world', use: { viewport: { width: 1024, height: 640 } }, testMatch: /world\.spec/ },
    { name: 'mobile', use: { ...devices['iPhone 13'], browserName: 'chromium' }, testMatch: /mobile\.spec/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node dist/server/main.mjs',
        port: PORT,
        reuseExistingServer: false,
        env: {
          DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgresql://dg:dg@localhost:5432/deliverygo_e2e',
          PORT: String(PORT),
          ADMIN_EMAIL: 'admin@e2e.local',
          ADMIN_PASSWORD: 'e2e-password-123456',
          DEMO_MODE: 'true',
          NODE_ENV: 'test',
        },
      },
});
