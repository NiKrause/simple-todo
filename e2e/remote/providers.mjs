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
