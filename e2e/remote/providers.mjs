import { chromium } from 'playwright';
import { createRequire } from 'node:module';
export {
	ALEPH_API_HOSTS,
	assertPlaywrightVersion,
	PLAYWRIGHT_VERSION,
	sanitizeAlephApiHosts,
	verifyAlephPlaywrightEndpoint
} from './aleph-provider-contract.mjs';
import {
	assertPlaywrightVersion,
	PLAYWRIGHT_VERSION,
	verifyAlephPlaywrightEndpoint
} from './aleph-provider-contract.mjs';

const require = createRequire(import.meta.url);
const installedPlaywrightVersion = require('playwright/package.json').version;

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
 *  versionUrl?: string,
 *  fetchImpl?: typeof globalThis.fetch,
 *  connectImpl?: (options: any) => Promise<any>
 * }} options
 */
export async function createAlephBrowser({
	wsEndpoint,
	secret,
	versionUrl,
	fetchImpl = globalThis.fetch,
	connectImpl = (options) => chromium.connect(options)
}) {
	assertPlaywrightVersion(installedPlaywrightVersion, PLAYWRIGHT_VERSION);
	if (!wsEndpoint?.startsWith('wss://')) {
		throw new Error('ALEPH_PLAYWRIGHT_WS_ENDPOINT must be an authenticated wss:// endpoint.');
	}
	const headers = await verifyAlephPlaywrightEndpoint({ versionUrl, secret, fetchImpl });

	return connectImpl({ wsEndpoint, headers, timeout: 120_000 });
}
