import { defineConfig, devices } from '@playwright/test';
import { PREVIEW_PORT } from './e2e/preview-origin.mjs';

// `e2e/start-e2e-server.mjs` already reads this; the config did not, so setting
// it moved the preview server without moving what Playwright waited for and
// what the tests browsed to. Two checkouts of this repo therefore could not run
// their suites at the same time — and worse, a preview left behind by another
// branch on 4173 would be silently used instead, so a suite could pass or fail
// against an app it never built. That is not hypothetical: it produced three
// contradictory runs before the page snapshot gave it away.
const previewPort = PREVIEW_PORT;

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
		// Without this, Playwright puts no limit on a single action: a `click()`
		// or `fill()` whose element never becomes actionable waits until the test
		// timeout, and the error names the line that gave up rather than the
		// locator that hung. That is why the relay-button failures could only
		// ever say "no wallet" — the harness was stuck inside `prepare()` with
		// nothing bounding it. Matched to the expect timeout so a slow action and
		// a slow assertion fail the same way.
		actionTimeout: 30_000,
		baseURL: `http://localhost:${previewPort}`,
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
