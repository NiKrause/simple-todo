import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'node e2e/start-e2e-server.mjs',
		port: 4173,
		reuseExistingServer: false,
		timeout: 240000
	},
	testDir: 'e2e',
	timeout: 60000,
	expect: {
		timeout: 30000
	},
	use: {
		baseURL: 'http://localhost:4173',
		// Capture screenshots on failure
		screenshot: 'only-on-failure',
		// Record video on first retry
		video: 'retain-on-failure',
		// Collect trace on failure
		trace: 'on-first-retry'
	},
	// Run the suite against Chrome/Chromium only.
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
