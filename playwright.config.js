import { defineConfig, devices } from '@playwright/test';

// `e2e/start-e2e-server.mjs` already reads this; the config did not, so setting
// it moved the preview server without moving what Playwright waited for and
// what the tests browsed to. Two checkouts of this repo therefore could not run
// their suites at the same time — and worse, a preview left behind by another
// branch on 4173 would be silently used instead, so a suite could pass or fail
// against an app it never built (#197).
const previewPort = Number(process.env.E2E_PREVIEW_PORT || 4173);

export default defineConfig({
	webServer: {
		command: 'node e2e/start-e2e-server.mjs',
		port: previewPort,
		reuseExistingServer: false,
		timeout: 240000
	},
	testDir: 'e2e',
	timeout: 60000,
	expect: {
		timeout: 30000
	},
	use: {
		baseURL: `http://localhost:${previewPort}`,
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
