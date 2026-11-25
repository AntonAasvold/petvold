import { defineConfig, devices } from '@playwright/test';

/**
 * The back office's flows in a browser (ADR 0035), against the API's dev server
 * in memory and Vite. CI runs it in the job ui.
 *
 * Own ports, and never a server that already runs: another app on the usual
 * ports must not be tested by mistake.
 */
const API_PORT = 8797;
const UI_PORT = 5181;

export default defineConfig({
  testDir: 'e2e',
  // One worker: the tests share one API server and its sample data, and some depend on the order.
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${UI_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], locale: 'en-GB' } }],
  webServer: [
    {
      // Started here, the dev server finds no .env and runs in memory: every run starts from the sample data.
      command: 'node --import tsx ../../modules/api/src/dev-server.ts',
      url: `http://127.0.0.1:${API_PORT}/openapi.yaml`,
      env: { PORT: String(API_PORT), PETVOLD_CORS_ORIGINS: `http://127.0.0.1:${UI_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // The icons first, as npm run dev does: public/icons is made, not kept in git.
      command: `npm run icons && npx vite --host 127.0.0.1 --port ${UI_PORT} --strictPort`,
      url: `http://127.0.0.1:${UI_PORT}`,
      env: { VITE_API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
