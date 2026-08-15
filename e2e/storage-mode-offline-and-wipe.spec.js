import { test, expect } from '@playwright/test';

// The two claims the storage switch makes that nothing else covers.
//
// Both reuse **one** browser context on purpose. `storage-mode-persistence`
// gives each mode its own context, which is right for comparing them but means
// it can never see what one mode leaves behind for the next — and "switching it
// off deletes what was written" is exactly a question about the profile that
// carries over.

const testUrl = '/';

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ mode: 'memory' | 'indexeddb', relay?: boolean }} options
 */
async function acceptConsent(page, { mode, relay = true }) {
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();

	await page
		.getByTestId(mode === 'indexeddb' ? 'consent-storage-indexeddb' : 'consent-storage-memory')
		.check();

	const relayToggle = page.getByTestId('consent-relay-network');
	if (relay) await relayToggle.check();
	else await relayToggle.uncheck();

	const confirmations = modal
		.locator('input[type="checkbox"]')
		.and(page.locator(':not([data-testid="consent-remember"])'))
		.and(page.locator(':not([data-testid="consent-relay-network"])'));
	for (const checkbox of await confirmations.all()) {
		await checkbox.check();
	}
	await page.getByRole('button', { name: 'Proceed to Test the App' }).click();
	await expect(modal).toBeHidden();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	const input = page.getByPlaceholder('What needs to be done?');
	await expect(input).toBeEnabled({ timeout: 60_000 });
	await input.fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout: 30_000 });
}

/** @param {import('@playwright/test').Page} page */
function ownedDatabases(page) {
	return page.evaluate(async () => {
		if (typeof indexedDB.databases !== 'function') return null;
		return (await indexedDB.databases())
			.map((db) => db.name)
			.filter(
				(name) =>
					typeof name === 'string' &&
					(name.startsWith('level-js-simple-todo/') || name.startsWith('level-js-orbitdb/'))
			);
	});
}

test.describe('Storage mode', () => {
	test('a todo written with IndexedDB is read back with no network and no relay', async ({
		browser
	}) => {
		// As close to the issue's "reload offline" as this app can currently get.
		//
		// The reload itself has to happen online: there is no service worker in
		// this project, so the app shell is fetched over HTTP every time and
		// `setOffline(true)` before a reload fails at `ERR_INTERNET_DISCONNECTED`
		// on the document, never reaching the code under test. Serving the shell
		// offline is a separate piece of work.
		//
		// What is asserted is the substance: the network is cut *before* the app
		// initialises, and the relay is switched off, so libp2p has neither a
		// bootstrap list nor a route to anyone. A todo that appears under those
		// conditions can only have come from IndexedDB.
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			await page.goto(testUrl);
			await acceptConsent(page, { mode: 'indexeddb', relay: false });

			const todo = `offline-${Date.now()}`;
			await addTodo(page, todo);

			await page.reload();
			await context.setOffline(true);
			await acceptConsent(page, { mode: 'indexeddb', relay: false });
			await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout: 60_000 });
		} finally {
			await context.setOffline(false);
			await context.close();
		}
	});

	test('switching from IndexedDB back to memory deletes what was written', async ({ browser }) => {
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			await page.goto(testUrl);
			await acceptConsent(page, { mode: 'indexeddb' });
			await addTodo(page, `wiped-${Date.now()}`);

			// Guard: without this the wipe assertion below could pass simply
			// because the persistent run never wrote anything.
			const written = await ownedDatabases(page);
			test.skip(written === null, 'This browser cannot enumerate IndexedDB.');
			expect(written?.length).toBeGreaterThan(0);

			await page.reload();
			await acceptConsent(page, { mode: 'memory' });

			// Asserted against IndexedDB, not the list: the UI would look empty
			// either way, which is precisely how this went unnoticed.
			await expect.poll(() => ownedDatabases(page), { timeout: 30_000 }).toEqual([]);
		} finally {
			await context.close();
		}
	});
});
