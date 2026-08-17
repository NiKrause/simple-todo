import { test, expect } from '@playwright/test';
import {
	openReadyApp as openApp,
	createPasskey,
	openListTab,
	pinTechnicalView
} from './open-app.mjs';

// Chapter (acl01), issue #114: creating a private list used to leave no trace in
// the UI. The list was created and became active, but its name was never
// rendered, the address the create box promises to share was dropped on the
// floor, and the header went on advertising the public list's mnemonic.
//
// These tests fail against the pre-fix build: `new-list-created` did not exist,
// and `active-list-kind` read "Shared list" after creating a private list.

const testUrl = '/';
const timeout = 90000;

test.describe('private list visibility (#114)', () => {
	test('creating a private list surfaces its name and address', async ({ page }) => {
		test.setTimeout(timeout * 3);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		const listName = `test-${Date.now().toString(36)}`;
		await openListTab(page, 'create');
		await page.getByTestId('new-list-name').fill(listName);
		await page.getByTestId('new-list-create').click();

		// The permissions panel proves the access-controlled list actually opened.
		await expect(page.getByTestId('permissions-panel')).toBeVisible({ timeout });

		const created = page.getByTestId('new-list-created');
		await expect(created).toBeVisible({ timeout });

		// 1. The name the user typed is shown back to them.
		await expect(page.getByTestId('new-list-created-name')).toHaveText(listName);

		// 2. The address is shown, and it is a real OrbitDB address — this is the
		//    "share its address" the box promises.
		const address = (await page.getByTestId('new-list-created-address').textContent())?.trim();
		expect(address).toMatch(/^\/orbitdb\/[A-Za-z0-9]+$/);

		// 3. It is the address of the list we are now writing to, not a leftover.
		const activeAddress = (await page.getByTestId('active-database-address').textContent())?.trim();
		expect(address).toBe(activeAddress);
	});

	test('the copy button puts the address on the clipboard', async ({ page, context }) => {
		test.setTimeout(timeout * 3);
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		await openListTab(page, 'create');
		await page.getByTestId('new-list-name').fill('clipboard-list');
		await page.getByTestId('new-list-create').click();
		await expect(page.getByTestId('new-list-created')).toBeVisible({ timeout });

		const shown = (await page.getByTestId('new-list-created-address').textContent())?.trim();
		await page.getByTestId('new-list-copy-address').click();
		await expect(page.getByTestId('new-list-copy-address')).toHaveText('Copied');

		const clipboard = await page.evaluate(() => navigator.clipboard.readText());
		expect(clipboard).toBe(shown);
	});

	test('the header names the active list instead of the shared mnemonic', async ({ page }) => {
		test.setTimeout(timeout * 3);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		// Before: the public list every visitor lands in.
		await expect(page.getByTestId('active-list-kind')).toHaveText('Shared list');
		const mnemonic = (await page.getByTestId('active-list-label').textContent())?.trim();
		expect(mnemonic).toMatch(/^·\s+\S+-\S+-\S+$/);

		const listName = `named-${Date.now().toString(36)}`;
		await openListTab(page, 'create');
		await page.getByTestId('new-list-name').fill(listName);
		await page.getByTestId('new-list-create').click();
		await expect(page.getByTestId('permissions-panel')).toBeVisible({ timeout });

		// After: the header must name the list actually being written to. This is
		// the assertion that failed before the fix — it read "Shared list" here.
		await expect(page.getByTestId('active-list-kind')).toHaveText('Private list');
		await expect(page.getByTestId('active-list-label')).toHaveText(`· ${listName}`);
		await expect(page.getByTestId('active-list-note')).toContainText(listName);
	});

	test('a list opened by address is labelled as a guest list', async ({ browser }) => {
		test.setTimeout(timeout * 5);
		const ownerContext = await browser.newContext();
		const guestContext = await browser.newContext();
		const owner = await ownerContext.newPage();
		const guest = await guestContext.newPage();

		try {
			await Promise.all([addVirtualAuthenticator(owner), addVirtualAuthenticator(guest)]);
			await Promise.all([openReadyApp(owner), openReadyApp(guest)]);

			await openListTab(owner, 'create');
			await owner.getByTestId('new-list-name').fill('shared-by-address');
			await owner.getByTestId('new-list-create').click();
			await expect(owner.getByTestId('new-list-created')).toBeVisible({ timeout });
			const address = (await owner.getByTestId('new-list-created-address').textContent())?.trim();
			expect(address).toBeTruthy();

			await openListTab(guest, 'open');
			await guest.getByTestId('open-db-address-input').fill(String(address));
			await guest.getByTestId('open-db-button').click();

			// The guest is reading someone else's list; calling that "Shared list"
			// would point at the mnemonic list they are no longer in.
			await expect(guest.getByTestId('active-list-kind')).toHaveText('Opened list', { timeout });
		} finally {
			await ownerContext.close();
			await guestContext.close();
		}
	});
});

/** @param {import('@playwright/test').Page} page */
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

/**
 * Open the app and give it a fresh passkey identity.
 *
 * qr01 has no consent gate: the app starts on mount with an anonymous
 * identity, so this waits for it to be usable and *then* upgrades through the
 * identity panel. The passkey has to be created from a real click — WebAuthn
 * refuses to run outside a user gesture, which is exactly why the panel exists
 * rather than an automatic prompt.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openReadyApp(page) {
	const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	// Via the shared helper, not a local copy of it. An inline copy here waited
	// for "the app looks ready" after the click, which is true of the stack the
	// restart is about to replace — and because the copy was local, fixing that
	// race in open-app.mjs did nothing for this file. That cost four tests in
	// list-registry.spec.js a long time to diagnose.
	// These assertions read the mnemonic block and the OrbitDB address, which
	// only exist in the technical view.
	await pinTechnicalView(page);
	await openApp(page, { url: testUrl, timeout });
	await createPasskey(page, {
		userId: `${runId}@example.com`,
		displayName: `User ${runId}`,
		timeout
	});
}
