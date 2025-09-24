import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	// Global setup and teardown for relay server
	globalSetup: './e2e/global-setup.js',
	globalTeardown: './e2e/global-teardown.js',

	// Web server configuration
	webServer: {
		command: 'npm run preview',
		port: 4173,
		// Use the test environment file
		env: {
			VITE_ENV_FILE: '.env.test'
		},
		// Wait for server to be ready
		timeout: 30000,
		reuseExistingServer: !process.env.CI
	},

	// Test configuration
	testDir: 'e2e',
	timeout: 60000, // 60 seconds per test
	expect: {
		// Increase timeout for P2P operations
		timeout: 15000
	},

	// Browser projects
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Enable features needed for P2P
				launchOptions: {
					args: [
						'--enable-features=NetworkService,NetworkServiceLogging',
						'--disable-features=VizDisplayCompositor',
						'--disable-web-security',
						'--allow-running-insecure-content',
						'--use-fake-ui-for-media-stream',
						'--use-fake-device-for-media-stream'
					]
				},
				// Grant permissions needed for WebRTC
				permissions: ['microphone', 'camera'],
				// Set user agent to avoid blocking
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
			}
		},
		{
			name: 'firefox',
			use: {
				...devices['Desktop Firefox'],
				permissions: ['microphone', 'camera']
			}
		},
		{
			name: 'webkit',
			use: {
				...devices['Desktop Safari'],
				permissions: ['microphone', 'camera']
			}
		}
	],

	// Reporter configuration
	reporter: [
		['html'],
		['list'],
		['junit', { outputFile: 'test-results/junit.xml' }]
	],

	// Output directory
	outputDir: 'test-results/',

	// Retry configuration
	retries: process.env.CI ? 2 : 1,

	// Worker configuration
	workers: process.env.CI ? 1 : 2, // Limit workers to avoid port conflicts

	// Use baseURL for all tests
	use: {
		baseURL: 'http://localhost:4173',
		// Take screenshots on failure
		screenshot: 'only-on-failure',
		// Record video on failure
		video: 'retain-on-failure',
		// Collect trace on failure
		trace: 'retain-on-failure'
	}
});
