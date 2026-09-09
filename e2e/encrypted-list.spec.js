import { test, expect } from '@playwright/test';
import { passConsent } from './consent.mjs';

// Chapter (privacy01), issue #277 Phase 1: a private list is sealed with a key
// that never leaves this browser, so holding the address is no longer enough
// to read it.
//
// The roadmap's acceptance test is "a device reads its own history back after a
// reload". This chapter cannot pass that yet, and not because of the key:
// `createHeliaLight` runs with no blockstore, so nothing written here survives
// a reload at all — measured and recorded in `list-registry.spec.js`, where the
// registry's own reload test is `fixme` for the same reason. That test is below
// with the same marker, so it starts passing when persistence arrives.
//
// Taking the key away and reopening the list in the same session does not
// prove anything either, though it looks like it should: `orbitdb.open`
// returns an already-open database from its cache and ignores the options it
// was called with (`orbitdb.js:121-123`), so the second open is the same
// database with the same encryptor. That the list is unreadable *without* the
// key is proven where it can be — `entry-encryption.spec.js`, which refuses a
// sealed payload under a different key.
//
// What these prove is that the app really seals: a created list is opened with
// an encryptor, its key is filed where the reopen path will look, and a todo
// written through it comes back — which it would not if the round trip were
// broken, since `entry.js` throws `Could not decrypt payload` rather than
// showing something wrong.

const testUrl = '/';
const timeout = 90000;

test.describe('an encrypted private list (#277)', () => {
	test('seals a private list under a key filed by address', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		const listName = `sealed-${Date.now().toString(36)}`;
		await page.getByTestId('new-list-name').fill(listName);
		await page.getByTestId('new-list-create').click();
		await expect(page.getByTestId('permissions-panel')).toBeVisible({ timeout });

		const address = (await page.getByTestId('new-list-created-address').textContent())?.trim();
		expect(address).toMatch(/^\/orbitdb\/[A-Za-z0-9]+$/);

		// The key is filed under the address, not the name it was created with.
		// A key under the name is not found when the list is reopened by address,
		// and a fresh one would be generated over sealed entries.
		const stored = await page.evaluate(
			(key) => localStorage.getItem(`privacy01.dbKey.${key}`),
			address
		);
		expect(stored).not.toBeNull();
		expect(
			await page.evaluate((n) => localStorage.getItem(`privacy01.dbKey.${n}`), listName)
		).toBeNull();

		// Written and read back through the encryptor. A broken round trip does
		// not show a wrong todo here, it shows none: `entry.js` throws
		// `Could not decrypt payload` and the entry never reaches the list.
		const todo = `secret-${Date.now().toString(36)}`;
		await page.getByPlaceholder('What needs to be done?').fill(todo);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(todo, { exact: true }).first()).toBeVisible({ timeout });
	});

	test('leaves the shared mnemonic list unsealed', async ({ page }) => {
		// The default list is `write: ['*']` and shared between browsers, so a
		// device-local key would break the collaboration collab01 teaches rather
		// than protect anything. It must stay in the clear until Phase 2 of #277
		// can hand a key to a second device.
		test.setTimeout(timeout * 3);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		const address = (await page.getByTestId('active-database-address').textContent())?.trim();
		expect(address).toMatch(/^\/orbitdb\/[A-Za-z0-9]+$/);

		const keys = await page.evaluate(() =>
			Object.keys(localStorage).filter((key) => key.startsWith('privacy01.dbKey.'))
		);
		expect(keys).toEqual([]);

		const todo = `shared-${Date.now().toString(36)}`;
		await page.getByPlaceholder('What needs to be done?').fill(todo);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(todo, { exact: true }).first()).toBeVisible({ timeout });
	});

	// Same reason as `list-registry.spec.js`: nothing this chapter writes
	// survives a reload, so this cannot distinguish a key that was not kept from
	// a database that was not kept.
	test.fixme('a device reads its own history back after a reload', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		const listName = `persist-${Date.now().toString(36)}`;
		await page.getByTestId('new-list-name').fill(listName);
		await page.getByTestId('new-list-create').click();
		const address = (await page.getByTestId('new-list-created-address').textContent())?.trim();

		const todo = `kept-${Date.now().toString(36)}`;
		await page.getByPlaceholder('What needs to be done?').fill(todo);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(todo, { exact: true }).first()).toBeVisible({ timeout });

		await page.reload();
		await dismissConsentWithExistingPasskey(page);
		await page.getByTestId('open-db-address-input').fill(String(address));
		await page.getByTestId('open-db-button').click();

		await expect(page.getByText(todo, { exact: true }).first()).toBeVisible({ timeout });
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

/** @param {import('@playwright/test').Page} page */
async function openReadyApp(page) {
	const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	await page.goto(testUrl);
	await passConsent(page, { identity: 'create', label: `User ${runId}` });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function dismissConsentWithExistingPasskey(page) {
	await passConsent(page, { identity: 'existing' });
}
