import { test, chromium } from '@playwright/test';
import { runQr01RemoteScenario } from './remote/qr01-scenario.mjs';
import { PREVIEW_ORIGIN } from './preview-origin.mjs';

/**
 * The qr01 handover, without a second machine.
 *
 * `main` has had a local counterpart since it was written; this one only ever
 * ran against an Aleph VM in CI, which is why six consecutive red runs went by
 * without anyone being able to look at it locally.
 *
 * What it cannot show is what the remote run is actually for: two browsers on
 * *different networks* finding each other. Here they share a host, so the
 * connection is trivial. What it does cover is everything up to that - the
 * seeded list, the invite link, the offer, the acceptance, replication, and the
 * closing assertion that no relay was involved.
 */
test('qr01 handover scenario works with separate local browsers', async ({ browser }) => {
	test.setTimeout(240_000);
	const browserB = await chromium.launch({ headless: true });

	try {
		await runQr01RemoteScenario({
			browserA: browser,
			browserB,
			appUrl: PREVIEW_ORIGIN,
			outputDir: 'test-results/remote-qr01-local'
		});
	} finally {
		await browserB.close();
	}
});
