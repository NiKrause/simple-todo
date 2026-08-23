import { test, expect } from '@playwright/test';
import { openReadyApp, openListTab } from './open-app.mjs';
import { PREVIEW_ORIGIN } from './preview-origin.mjs';

/**
 * The meeting place, and the list it fills.
 *
 * Two browsers that never scanned anything. They meet because they call out on
 * a topic the relay between them carries, and each then appears in the other's
 * peer list — which is the list a person picks a recipient from.
 *
 * Needs `E2E_RELAY_MODE=local`: with no relay there is no meeting place, and
 * this would be asserting nothing.
 *
 * What it does not cover is the second topic. The local relay is an
 * `orbitdb-relay` and carries only the first; that both are configured is
 * pinned in `libp2p-config.spec.js` instead, the way `Le-Space/ablage` splits
 * the same claim.
 */
test('two browsers that only share a relay find each other', async ({ browser }) => {
	test.setTimeout(180_000);
	const timeout = 60_000;

	const one = await browser.newContext();
	const two = await browser.newContext();
	const alice = await one.newPage();
	const bob = await two.newPage();

	try {
		await Promise.all([
			openReadyApp(alice, { url: PREVIEW_ORIGIN, relay: true, timeout }),
			openReadyApp(bob, { url: PREVIEW_ORIGIN, relay: true, timeout })
		]);

		await openListTab(alice, 'transfer');
		await openListTab(bob, 'transfer');

		// Nobody typed an address and nobody held up a code.
		await expect(alice.getByTestId('peer-handover-row').first()).toBeVisible({ timeout });
		await expect(bob.getByTestId('peer-handover-row').first()).toBeVisible({ timeout });
	} finally {
		await one.close();
		await two.close();
	}
});
