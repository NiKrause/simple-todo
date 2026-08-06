import { test, expect } from '@playwright/test';

// Chapter (acl01), issue #114 step 3: the registry.
//
// Which lists you own lives in its own OrbitDB database, not in localStorage,
// so it replicates with the identity. Its name is derived from a signature the
// identity makes over a fixed string rather than from the DID — a DID-derived
// name would let anyone who has seen one of your todos enumerate every list you
// own, because OrbitDB gates appends, not reads.
//
// Reload durability is a separate matter and is marked fixme below — it is not
// a property this chapter has for any self-created database.

const testUrl = '/';
const timeout = 90000;

test.describe('list registry (#114)', () => {
	test('created lists appear in the switcher', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		const first = `alpha-${Date.now().toString(36)}`;
		const second = `beta-${Date.now().toString(36)}`;

		await createList(page, first);
		await createList(page, second);

		const switcher = page.getByTestId('list-switcher');
		await expect(switcher).toBeVisible({ timeout });
		await expect(switcher).toContainText(first);
		await expect(switcher).toContainText(second);

		// The list created last is the one being written to.
		await expect(page.getByTestId('active-list-label')).toHaveText(`· ${second}`);
	});

	// Reload durability is not a property this chapter has yet, for the registry
	// or for anything else. Helia runs in memory here (createHeliaLight with no
	// blockstore), so a database created only in this browser has to come back
	// from the relay — and it does not. Measured: a todo written to a private
	// list before a reload does not return afterwards even when the list is
	// reopened by its exact address, so this is not specific to the registry.
	//
	// The derivation itself is fine and was measured directly: the registry name
	// is byte-identical before and after a reload
	// (list-registry-82d642cc19d743104ebe14f7af01b1e5 both times), so what is
	// missing is replication, not reproducibility.
	test('the registry survives a reload', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		const name = `persist-${Date.now().toString(36)}`;
		await createList(page, name);
		await page.waitForTimeout(20000);

		await page.reload();
		await dismissConsent(page);
		await expect(page.getByTestId('list-switcher')).toBeVisible({ timeout });
		await expect(page.getByTestId('list-switcher')).toContainText(name);
	});

	test('switching lists changes the active list', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		const first = `one-${Date.now().toString(36)}`;
		const second = `two-${Date.now().toString(36)}`;
		await createList(page, first);
		const firstAddress = await currentAddress(page);
		await createList(page, second);

		await expect(page.getByTestId('active-list-label')).toHaveText(`· ${second}`);

		// Switch back to the first list through the switcher.
		await page
			.locator(`[data-testid="list-switcher-open"][data-address="${firstAddress}"]`)
			.click();

		await expect(page.getByTestId('active-list-label')).toHaveText(`· ${first}`, { timeout });
		await expect(page.getByTestId('active-database-address')).toHaveText(firstAddress, {
			timeout
		});
	});

	test('the registry name is not derivable from the DID', async ({ page }) => {
		test.setTimeout(timeout * 3);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);
		await createList(page, 'anything');

		const did = await page.getByTestId('own-did-value').getAttribute('data-did');
		expect(did).toBeTruthy();

		// The guard this design exists for: the registry's name must not contain
		// the DID, or anyone who has seen a todo of yours could open it.
		const registryName = await page.getByTestId('list-switcher').getAttribute('data-registry-name');

		expect(registryName).toMatch(/^list-registry-[0-9a-f]{32}$/);
		expect(registryName).not.toContain(String(did));
	});

	test('forgetting a list removes it from the switcher only', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await addVirtualAuthenticator(page);
		await openReadyApp(page);

		const name = `forget-${Date.now().toString(36)}`;
		await createList(page, name);
		const address = await currentAddress(page);
		await expect(page.getByTestId('list-switcher')).toContainText(name);

		await page.locator(`[data-testid="list-switcher-forget"][data-address="${address}"]`).click();
		// It was the only entry, so the whole switcher goes away rather than
		// rendering an empty box.
		await expect(page.getByTestId('list-switcher')).toBeHidden({ timeout });

		// The database is untouched: opening it by address works and re-registers it.
		await page.getByTestId('open-db-address-input').fill(address);
		await page.getByTestId('open-db-button').click();
		await expect(page.getByTestId('active-database-address')).toHaveText(address, { timeout });
		await expect(page.getByTestId('list-switcher')).toContainText(address, { timeout });
	});
});

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function createList(page, name) {
	await page.getByTestId('new-list-name').fill(name);
	await page.getByTestId('new-list-create').click();
	await expect(page.getByTestId('new-list-created-name')).toHaveText(name, { timeout });
}

/** @param {import('@playwright/test').Page} page */
async function currentAddress(page) {
	const address = (await page.getByTestId('active-database-address').textContent())?.trim();
	if (!address) throw new Error('no active database address');
	return address;
}

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
 * After a reload the consent modal comes back with the identity preselected for
 * recovery; clear it without creating a second passkey.
 * @param {import('@playwright/test').Page} page
 */
async function dismissConsent(page) {
	const modal = page.locator('div.fixed.inset-0.z-50');
	if (!(await modal.isVisible().catch(() => false))) return;
	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	await page.getByTestId('identity-mode-existing').check();
	await page.getByRole('button', { name: 'Open shared list' }).click();
	await expect(modal).not.toBeVisible({ timeout });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function openReadyApp(page) {
	const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	await page.goto(testUrl);
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();
	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	await page.getByTestId('identity-mode-create').check();
	await page.getByTestId('passkey-user-id').fill(`${runId}@example.com`);
	await page.getByTestId('passkey-display-name').fill(`User ${runId}`);
	await page.getByRole('button', { name: 'Open shared list' }).click();
	await expect(modal).not.toBeVisible({ timeout });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}
