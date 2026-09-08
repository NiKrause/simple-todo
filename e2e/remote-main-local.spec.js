import { test, chromium } from '@playwright/test';
import { runMainRemoteScenario } from './remote/main-scenario.mjs';
import { PREVIEW_ORIGIN } from './preview-origin.mjs';

test('provider-neutral main replication scenario works with separate local browsers', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const browserB = await chromium.launch({ headless: true });

	try {
		await runMainRemoteScenario({
			browserA: browser,
			browserB,
			appUrl: PREVIEW_ORIGIN,
			outputDir: 'test-results/remote-main-local'
		});
	} finally {
		await browserB.close();
	}
});
