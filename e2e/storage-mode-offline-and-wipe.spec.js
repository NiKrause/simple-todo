import { test, expect } from '@playwright/test';
import { passConsent } from './consent.mjs';

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
	await passConsent(page, { persistent: mode === 'indexeddb', relay });
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
	test('a todo written with IndexedDB survives a reload with the network cut', async ({
		browser
	}) => {
		// #144 called this test the feature itself, and until the service worker
		// landed it was impossible: the app shell was fetched over HTTP on every
		// load, so going offline first failed at ERR_INTERNET_DISCONNECTED on the
		// document and never reached the code under test.
		//
		// Now the shell comes from the cache and the todo from IndexedDB, with the
		// relay switched off as well — nothing here can have come over a wire.
		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			await page.goto(testUrl);
			await acceptConsent(page, { mode: 'indexeddb', relay: false });

			const todo = `offline-${Date.now()}`;
			await addTodo(page, todo);

			// The worker controls the page only once it has activated; reloading
			// before that would fetch from the network and prove nothing.
			await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
				timeout: 30_000
			});

			await context.setOffline(true);
			await page.reload();
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
