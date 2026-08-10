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
		// Collect trace on failure — which `on-first-retry` did NOT do, because no
		// `retries` are configured, so there is never a first retry. A 50-minute
		// relay provisioning run that fails opaquely is undiagnosable without the
		// call log, and that is exactly what happened while chasing #137.
		trace: 'retain-on-failure'
	},
	// Run the suite against Chrome/Chromium only.
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] }
		}
	]
});
