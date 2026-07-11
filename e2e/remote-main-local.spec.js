import { test, chromium } from '@playwright/test';
import { runMainRemoteScenario } from './remote/main-scenario.mjs';

test('provider-neutral main replication scenario works with separate local browsers', async ({
	browser
}) => {
	test.setTimeout(240_000);
	const browserB = await chromium.launch({ headless: true });

	try {
		await runMainRemoteScenario({
			browserA: browser,
			browserB,
			appUrl: 'http://localhost:4173',
			outputDir: 'test-results/remote-main-local'
		});
	} finally {
		await browserB.close();
	}
});
