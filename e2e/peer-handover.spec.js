import { test, expect } from '@playwright/test';
import { openReadyApp, expectAppReady, openListTab } from './open-app.mjs';
import { handshake } from './qr-handover.mjs';
import { PREVIEW_ORIGIN } from './preview-origin.mjs';

// Handing a list over without holding up a code.
//
// The code is still the right answer when the other phone is in front of you.
// This covers the case it cannot serve: the other device is reachable but not
// present, which is what a relay makes possible. The connection here is still
// built by a scan - two browsers on one machine have no relay to meet through -
// but the *sending* goes the new way, from the peer list, which is the part that
// used to be impossible: `sendListOffer` dialled the QR session, and only peers
// whose code had been scanned were in it.
//
// Run with E2E_RELAY_MODE=isolated, like the QR handover it sits beside.
test.describe('handing a list to a connected peer', () => {
	const timeout = 60_000;
	const testUrl = `${PREVIEW_ORIGIN}/?ice=stun`;

	test('the panel names what it can do before anyone is connected', async ({ page }) => {
		await openReadyApp(page, { url: testUrl, relay: false, timeout });
		await expectAppReady(page, timeout);
		await openListTab(page, 'transfer');

		await expect(page.getByTestId('peer-handover')).toBeVisible({ timeout });
		// An empty list says so rather than showing nothing: a panel with no rows
		// and no sentence reads as broken.
		await expect(page.getByTestId('peer-handover-empty')).toBeVisible({ timeout });
	});

	test('a declined list can be sent again from the peer list', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			await Promise.all([
				openReadyApp(alice, { url: testUrl, relay: false, timeout }),
				openReadyApp(bob, { url: testUrl, relay: false, timeout })
			]);

			await openListTab(alice, 'create');
			await alice.getByTestId('new-list-seed-site').click();
			await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout });

			await handshake(alice, bob, { timeout });

			// The scan sends the offer by itself. Bob says no, which is what makes
			// the rest of this test about the peer list rather than about the scan.
			const dialog = bob.getByTestId('list-offer-dialog');
			await expect(dialog).toBeVisible({ timeout });
			await bob.getByTestId('list-offer-decline').click();
			await expect(dialog).toBeHidden({ timeout });

			// Bob is still connected, and now appears as a row Alice can act on.
			await openListTab(alice, 'transfer');
			const rows = alice.getByTestId('peer-handover-row');
			await expect(rows.first()).toBeVisible({ timeout });

			await alice.getByTestId('peer-handover-send').first().click();

			// Same list, same connection, a path that never touched the QR session.
			await expect(dialog).toBeVisible({ timeout });
			await expect(bob.getByTestId('list-offer-name')).toContainText('Excavation and basement');
			await expect(alice.getByTestId('peer-handover-sent')).toBeVisible({ timeout });
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});
