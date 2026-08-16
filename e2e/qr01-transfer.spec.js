import { test, expect } from '@playwright/test';
import { openReadyApp, createPasskey, expectAppReady, todoInput } from './open-app.mjs';
// The strings only — `site-list.js` imports the app, and pulling
// `import.meta.env` into the Node test runner makes collection fail for the
// whole suite, not just this file.
import { SITE_TODOS } from '../src/lib/site-todos.js';

// Chapter (qr01): Alice prepares the site list in the office and hands it to
// Bob on a building site with no internet. The only introduction between the
// two devices is a code one of them held up.
//
// Run with E2E_RELAY_MODE=isolated — the mode that starts no relay and
// configures no bootstrap address. That is not a detail: with a relay present
// these assertions could all pass *through* it, proving the opposite of what
// the chapter claims.

const testUrl = '/';
const timeout = 90_000;

// The camera is the one thing a headless browser cannot supply. Everything
// after the payload arrives is the same code the scanner drives — the two paths
// differ in where the text came from and nowhere else.
const QR_TYPE_OFFER = 'offer';
const QR_TYPE_ANSWER = 'answer';

test.describe('QR handover', () => {
	test('a scanned code is the only introduction, and the list follows it', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			// Bob takes a passkey identity: the list registry is keyed to a signing
			// identity, so an anonymous session would lose the imported list on the
			// reload asserted at the end.
			await addVirtualAuthenticator(bob);

			await Promise.all([
				openReadyApp(alice, { url: testUrl, timeout }),
				openReadyApp(bob, { url: testUrl, timeout })
			]);

			const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			await createPasskey(bob, {
				userId: `bob-${runId}@example.com`,
				displayName: 'Bob',
				timeout
			});

			// Alice prepares the ten items in the office.
			await alice.getByTestId('new-list-seed-site').click();
			await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout });
			await expect(alice.getByText(SITE_TODOS[0], { exact: true })).toBeVisible({ timeout });
			await expect(alice.getByText(SITE_TODOS[SITE_TODOS.length - 1], { exact: true })).toBeVisible(
				{ timeout }
			);
			const aliceAddress = await databaseAddress(alice);

			await handshake(alice, bob);

			// Bob is asked, not told: the address arriving is not consent to
			// replicate somebody else's database.
			const dialog = bob.getByTestId('list-offer-dialog');
			await expect(dialog).toBeVisible({ timeout });
			await expect(bob.getByTestId('list-offer-address')).toContainText(aliceAddress);
			await expect(bob.getByTestId('list-offer-name')).toContainText('Excavation and basement');

			await bob.getByTestId('list-offer-accept').click();
			await expect(dialog).toBeHidden({ timeout });

			// All ten items replicate over the connection the code built.
			for (const todo of SITE_TODOS) {
				await expect(bob.getByText(todo, { exact: true })).toBeVisible({ timeout });
			}
			expect(await databaseAddress(bob)).toBe(aliceAddress);

			// Held, not owned. acl01's registry already draws this distinction and
			// the write is refused by the access controller rather than by the UI.
			await expect(bob.getByTestId('list-switcher')).toContainText('Excavation and basement', {
				timeout
			});
			await todoInput(bob).fill(`bob-cannot-write-${runId}`);
			await bob.getByRole('button', { name: 'Add TODO' }).click();
			await expect(bob.getByText(/no write permission|write access/i)).toBeVisible({ timeout });
			await expect(bob.getByText(`bob-cannot-write-${runId}`, { exact: true })).toHaveCount(0);

			// The claim, asserted rather than assumed: no relay, no bootstrap peer,
			// nothing but the peer on the other end of the scanned code.
			//
			// Checked here, before the reload — a reloaded Bob is a new libp2p node
			// with no connections at all, so asserting it afterwards would compare
			// Alice against a peer id that never existed while they were talking.
			const [alicePeers, bobPeers] = await Promise.all([
				connectedPeerIds(alice),
				connectedPeerIds(bob)
			]);
			const [alicePeerId, bobPeerId] = await Promise.all([peerId(alice), peerId(bob)]);
			expect(alicePeers).toEqual([bobPeerId]);
			expect(bobPeers).toEqual([alicePeerId]);

			// The imported list survives a reload.
			//
			// This is the assertion that forced IndexedDB storage. In memory it
			// failed, and correctly so: every other chapter can refetch what the
			// browser forgot because a relay is holding it, and this one has no
			// relay to refetch from. Persisting Helia's blocks and datastore is
			// what makes a list handed over on a building site still be there the
			// next morning — with the connection long gone.
			await bob.reload();
			await expectAppReady(bob, timeout);
			await bob.getByTestId('identity-recover').click();
			await expectAppReady(bob, timeout);

			// The registry remembers it. The app opens its own default list on
			// mount, so Bob reopens the received one the way a person would —
			// which is also what proves the *blocks* survived and not merely the
			// entry naming them.
			await expect(bob.getByTestId('list-switcher')).toContainText('Excavation and basement', {
				timeout
			});
			await bob
				.locator(`[data-testid="list-switcher-open"][data-address="${aliceAddress}"]`)
				.click();
			for (const todo of SITE_TODOS) {
				await expect(bob.getByText(todo, { exact: true })).toBeVisible({ timeout });
			}

			// And with nobody to fetch them from: the connection died with the
			// old page, so these ten items came off this device's own disk.
			expect(await connectedPeerIds(bob)).toEqual([]);
		} finally {
			await bobContext.close();
			await aliceContext.close();
		}
	});

	test('declining imports nothing', async ({ browser }) => {
		test.setTimeout(timeout * 3);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			await Promise.all([
				openReadyApp(alice, { url: testUrl, timeout }),
				openReadyApp(bob, { url: testUrl, timeout })
			]);

			await alice.getByTestId('new-list-seed-site').click();
			await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout });
			const bobAddressBefore = await databaseAddress(bob);

			await handshake(alice, bob);

			const dialog = bob.getByTestId('list-offer-dialog');
			await expect(dialog).toBeVisible({ timeout });
			await bob.getByTestId('list-offer-decline').click();
			await expect(dialog).toBeHidden({ timeout });

			// Nothing opened, nothing recorded, and none of Alice's items arrived.
			expect(await databaseAddress(bob)).toBe(bobAddressBefore);
			await expect(bob.getByText(SITE_TODOS[0], { exact: true })).toHaveCount(0);
		} finally {
			await bobContext.close();
			await aliceContext.close();
		}
	});
});

/**
 * The roundtrip: Alice offers, Bob answers, Alice accepts the answer.
 *
 * @param {import('@playwright/test').Page} alice
 * @param {import('@playwright/test').Page} bob
 */
async function handshake(alice, bob) {
	await alice.getByTestId('qr-transfer-start').click();

	const offer = await alice.waitForFunction(
		() => window.__simpleTodoQr?.offerPayload?.() || null,
		undefined,
		{ timeout }
	);
	const offerText = await offer.jsonValue();

	const answerText = await bob.evaluate(
		async ([text, type]) => {
			await window.__simpleTodoQr.useScannedPayload(text, type);
			return window.__simpleTodoQr.offerPayload();
		},
		[offerText, QR_TYPE_OFFER]
	);
	expect(answerText).toBeTruthy();

	await alice.evaluate(
		async ([text, type]) => window.__simpleTodoQr.useScannedPayload(text, type),
		[answerText, QR_TYPE_ANSWER]
	);

	await expect(alice.getByTestId('qr-transfer-connected')).toBeVisible({ timeout });
}

/**
 * Attach a virtual authenticator so WebAuthn runs without an OS dialog.
 * @param {import('@playwright/test').Page} page
 */
async function addVirtualAuthenticator(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasLargeBlob: true,
			automaticPresenceSimulation: true
		}
	});
}

/** @param {import('@playwright/test').Page} page */
function databaseAddress(page) {
	return page.evaluate(() => window.__simpleTodoE2E.getDatabaseAddress());
}

/** @param {import('@playwright/test').Page} page */
function connectedPeerIds(page) {
	return page.evaluate(() => window.__simpleTodoE2E.getConnectedPeerIds());
}

/** @param {import('@playwright/test').Page} page */
function peerId(page) {
	return page.evaluate(() => window.__simpleTodoE2E.getPeerId());
}
