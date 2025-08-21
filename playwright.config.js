import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 30000
  },
  // Let BrowserStack SDK handle parallelization
  workers: 1,
  reporter: 'line',
  
  use: {
    // Screenshots and videos will be handled by BrowserStack
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry'
  },

  // BrowserStack SDK handles browser selection via browserstack.yml
  // No projects needed here
});
