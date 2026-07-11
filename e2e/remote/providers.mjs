import { chromium } from 'playwright';

export async function createLocalBrowser() {
	return chromium.launch({ headless: true });
}

export async function createTestingBotBrowser({ key, secret, buildName, testName }) {
	if (!key || !secret) {
		throw new Error(
			'TESTINGBOT_KEY and TESTINGBOT_SECRET are required for the TestingBot provider.'
		);
	}

	const capabilities = {
		browserName: process.env.REMOTE_BROWSER || 'chrome',
		browserVersion: process.env.REMOTE_BROWSER_VERSION || 'latest',
		platform: process.env.REMOTE_PLATFORM || 'LINUX',
		'tb:options': {
			key,
			secret,
			build: buildName,
			name: testName
		}
	};

	return chromium.connect({
		wsEndpoint: `wss://cloud.testingbot.com/playwright?capabilities=${encodeURIComponent(
			JSON.stringify(capabilities)
		)}`,
		timeout: 120_000
	});
}
