import { test, expect } from '@playwright/test';
import {
	openReadyApp,
	createPasskey,
	expectAppReady,
	todoInput,
	openListTab
} from './open-app.mjs';
import { handshake, addVirtualAuthenticator } from './qr-handover.mjs';
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
// `relay: false` on every `openReadyApp` here, because the claim under test is
// that two devices met by nothing but a scanned code. The workflow runs this
// spec with E2E_RELAY_MODE=isolated for the same reason — that keeps a relay
// out of the *build*, and this keeps one out of the *node*, so the spec is
// honest in either mode. Measured: in the default `local` mode without it,
// Alice's peer list carried the relay alongside Bob and the assertion failed
// on a connection the chapter never claimed to avoid making.
const timeout = 90_000;

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
				openReadyApp(alice, { url: testUrl, relay: false, timeout }),
				openReadyApp(bob, { url: testUrl, relay: false, timeout })
			]);

			const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			await createPasskey(bob, {
				userId: `bob-${runId}@example.com`,
				displayName: 'Bob',
				timeout
			});

			// Alice prepares the ten items in the office.
			await openListTab(alice, 'create');
			await alice.getByTestId('new-list-seed-site').click();
			await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout });
			await expect(alice.getByText(SITE_TODOS[0], { exact: true })).toBeVisible({ timeout });
			await expect(alice.getByText(SITE_TODOS[SITE_TODOS.length - 1], { exact: true })).toBeVisible(
				{ timeout }
			);
			const aliceAddress = await databaseAddress(alice);

			await handshake(alice, bob, { timeout });

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
			await openListTab(bob, 'create');
			await expect(bob.getByTestId('list-switcher')).toContainText('Excavation and basement', {
				timeout
			});
			await todoInput(bob).fill(`bob-cannot-write-${runId}`);
			await bob.getByTestId('todo-add').click();
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
			await openListTab(bob, 'create');
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

	test('a list from a second sender lands beside the first', async ({ browser }) => {
		// #181 asked for this and it was the criterion left over: nothing in the
		// flow is pairwise, and a third peer is the first situation where that
		// could quietly stop being true. The registry is keyed by address, so
		// there is no reason to expect a clash - which is exactly the kind of
		// reasoning this chapter spent its first milestone refusing to accept.
		test.setTimeout(timeout * 6);

		const aliceContext = await browser.newContext();
		const carolContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const carol = await carolContext.newPage();
		const bob = await bobContext.newPage();

		try {
			await addVirtualAuthenticator(bob);
			await Promise.all([
				openReadyApp(alice, { url: testUrl, relay: false, timeout }),
				openReadyApp(carol, { url: testUrl, relay: false, timeout }),
				openReadyApp(bob, { url: testUrl, relay: false, timeout })
			]);

			const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			await createPasskey(bob, {
				userId: `bob-${runId}@example.com`,
				displayName: 'Bob',
				timeout
			});

			// Two senders, two lists. Alice keeps the seeded site list; Carol makes
			// one with a name of her own, so the switcher has two entries that can
			// be told apart by more than their address.
			await openListTab(alice, 'create');
			await alice.getByTestId('new-list-seed-site').click();
			await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout });
			const aliceAddress = await databaseAddress(alice);

			const carolListName = `carol-${runId}`;
			await openListTab(carol, 'create');
			await carol.getByTestId('new-list-name').fill(carolListName);
			await carol.getByTestId('new-list-create').click();
			await expect(carol.getByTestId('new-list-created-name')).toHaveText(carolListName, {
				timeout
			});
			const carolAddress = await databaseAddress(carol);
			expect(carolAddress).not.toBe(aliceAddress);

			// One handshake at a time: each is a separate scan in the story, and
			// the second must not disturb what the first left behind.
			await handshake(alice, bob, { timeout });
			await acceptOffer(bob, aliceAddress, timeout);

			await handshake(carol, bob, { timeout });
			await acceptOffer(bob, carolAddress, timeout);

			// Both in the switcher, and both openable - a registry entry that
			// cannot be opened is a row, not a list.
			await openListTab(bob, 'create');
			const switcher = bob.getByTestId('list-switcher');
			await expect(switcher).toContainText('Excavation and basement', { timeout });
			await expect(switcher).toContainText(carolListName, { timeout });

			await bob
				.locator(`[data-testid="list-switcher-open"][data-address="${aliceAddress}"]`)
				.click();
			await expect(bob.getByText(SITE_TODOS[0], { exact: true })).toBeVisible({ timeout });
			expect(await databaseAddress(bob)).toBe(aliceAddress);

			await bob
				.locator(`[data-testid="list-switcher-open"][data-address="${carolAddress}"]`)
				.click();
			await expect.poll(() => databaseAddress(bob), { timeout }).toBe(carolAddress);
			// Carol's list is empty, and Alice's items must not have followed the
			// switch - the failure this guards against is one database being shown
			// under the other's name.
			await expect(bob.getByText(SITE_TODOS[0], { exact: true })).toHaveCount(0);
		} finally {
			await bobContext.close();
			await carolContext.close();
			await aliceContext.close();
		}
	});

	test('dropping a received list takes its data with it', async ({ browser }) => {
		// `forget` and `drop` are two different intents, and the README promises
		// the difference: forget stops tracking and leaves the data, drop deletes
		// it here as well. `list-registry.spec.js` pins forget; nothing pinned
		// drop, and the switcher looks identical either way - which is precisely
		// how a storage switch on `main` went weeks without deleting anything
		// (#144).
		test.setTimeout(timeout * 4);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			await addVirtualAuthenticator(bob);
			await Promise.all([
				openReadyApp(alice, { url: testUrl, relay: false, timeout }),
				openReadyApp(bob, { url: testUrl, relay: false, timeout })
			]);

			const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			await createPasskey(bob, {
				userId: `bob-${runId}@example.com`,
				displayName: 'Bob',
				timeout
			});

			await openListTab(alice, 'create');
			await alice.getByTestId('new-list-seed-site').click();
			await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout });
			const aliceAddress = await databaseAddress(alice);

			await handshake(alice, bob, { timeout });
			await acceptOffer(bob, aliceAddress, timeout);
			for (const todo of SITE_TODOS) {
				await expect(bob.getByText(todo, { exact: true })).toBeVisible({ timeout });
			}

			await openListTab(bob, 'create');
			await expect(bob.getByTestId('list-switcher')).toContainText('Excavation and basement', {
				timeout
			});
			await bob
				.locator(`[data-testid="list-switcher-drop"][data-address="${aliceAddress}"]`)
				.click();

			// Gone from the switcher.
			await expect(
				bob.locator(`[data-testid="list-switcher-open"][data-address="${aliceAddress}"]`)
			).toHaveCount(0, { timeout });

			// And gone from the device, which is the half a switcher cannot show.
			// Reopening by address gives back the same database with nothing in
			// it: Alice is long disconnected and there is no relay to refetch
			// from, so anything that appeared would have to have survived the drop.
			await openListTab(bob, 'open');
			await bob.getByTestId('open-db-address-input').fill(aliceAddress);
			await bob.getByTestId('open-db-button').click();
			// Asked of the app, not of the DOM: `active-database-address` lives in
			// a panel that the tab bodies render with `{#if}`, so from this tab it
			// is absent rather than hidden and the wait is for an element that
			// cannot appear.
			await expect.poll(() => databaseAddress(bob), { timeout }).toBe(aliceAddress);
			await expect(bob.getByText(SITE_TODOS[0], { exact: true })).toHaveCount(0);
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
				openReadyApp(alice, { url: testUrl, relay: false, timeout }),
				openReadyApp(bob, { url: testUrl, relay: false, timeout })
			]);

			await openListTab(alice, 'create');
			await alice.getByTestId('new-list-seed-site').click();
			await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout });
			const bobAddressBefore = await databaseAddress(bob);

			await handshake(alice, bob, { timeout });

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
 * Take the list somebody just offered.
 *
 * Bob is asked, not told: an address arriving is not consent to replicate
 * somebody else's database, and three tests now walk through that dialog.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} address the address the offer must be for
 * @param {number} timeout
 */
async function acceptOffer(page, address, timeout) {
	const dialog = page.getByTestId('list-offer-dialog');
	await expect(dialog).toBeVisible({ timeout });
	await expect(page.getByTestId('list-offer-address')).toContainText(address);
	await page.getByTestId('list-offer-accept').click();
	await expect(dialog).toBeHidden({ timeout });
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
