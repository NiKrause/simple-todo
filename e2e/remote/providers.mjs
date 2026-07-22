import { chromium } from 'playwright';
export {
	ALEPH_API_HOSTS,
	sanitizeAlephApiHosts
} from './aleph-provider-contract.mjs';

export { PLAYWRIGHT_VERSION } from './aleph-provider-contract.mjs';

import { connectAlephChromium, PLAYWRIGHT_RUNNER_VERSION } from '@le-space/playwright';

export async function createLocalBrowser() {
	return chromium.launch({ headless: true });
}

/** @param {{key?: string, secret?: string, buildName: string, testName: string}} options */
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

/**
 * @param {{
 *  wsEndpoint?: string,
 *  secret?: string,
 *  versionUrl?: string
 * }} options
 */
export async function createAlephBrowser({ wsEndpoint, secret, versionUrl }) {
	return connectAlephChromium({
		chromium: { connect: (endpoint, options) => chromium.connect(endpoint, options) },
		wsEndpoint,
		versionUrl,
		secret,
		expectedVersion: PLAYWRIGHT_RUNNER_VERSION
	});
}
