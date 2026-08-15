import { test, expect } from '@playwright/test';

// What the storage toggle is for: whether a todo is still there after a reload.
//
// Both halves matter and are asserted separately. "In Memory Only" losing the
// todo is not a bug to be tolerated — it is the promise its label makes, and a
// regression that quietly persisted everything would break the consent screen's
// word rather than any test named after persistence.
//
// #144 is the reason the persistent side needs an end-to-end check at all:
// OrbitDB already wrote its heads through LevelStorage, so a shallower test
// could pass on heads alone while the blocks they point at stayed in a
// MemoryBlockstore and the todo never rendered.

const testUrl = '/';

/**
 * @param {import('@playwright/test').Page} page
 * @param {'memory' | 'indexeddb'} mode
 */
async function acceptConsent(page, mode) {
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();

	await page
		.getByTestId(mode === 'indexeddb' ? 'consent-storage-indexeddb' : 'consent-storage-memory')
		.check();

	// Everything except "Don't show this again": the reload below has to bring
	// the modal back, both to re-pick the mode and to prove the stored choice
	// survives. Remembering consent would skip it and hide that.
	const confirmations = modal
		.locator('input[type="checkbox"]')
		.and(page.locator(':not([data-testid="consent-remember"])'));
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

test.describe('Storage mode', () => {
	test('IndexedDB keeps a todo across a reload, memory does not', async ({ browser }) => {
		// One context per mode, never reused: the choice is read once while the
		// node is built, so a context that already ran in memory could not be
		// switched without tearing that node down.
		const persistent = await browser.newContext();
		const ephemeral = await browser.newContext();

		try {
			const keptPage = await persistent.newPage();
			await keptPage.goto(testUrl);
			await acceptConsent(keptPage, 'indexeddb');
			const kept = `persisted-${Date.now()}`;
			await addTodo(keptPage, kept);

			// Consent was not remembered, so the modal returns — proving the choice
			// itself survives in localStorage rather than only for this page view.
			await keptPage.reload();
			await acceptConsent(keptPage, 'indexeddb');
			await expect(keptPage.getByText(kept, { exact: true })).toBeVisible({ timeout: 60_000 });

			const lostPage = await ephemeral.newPage();
			await lostPage.goto(testUrl);
			await acceptConsent(lostPage, 'memory');
			const lost = `ephemeral-${Date.now()}`;
			await addTodo(lostPage, lost);

			await lostPage.reload();
			await acceptConsent(lostPage, 'memory');
			// Asserted as an absence with a real wait: a hasty check would pass
			// simply because the app had not finished loading its history yet.
			await keptPage.waitForTimeout(5_000);
			await expect(lostPage.getByText(lost, { exact: true })).toHaveCount(0);
		} finally {
			await ephemeral.close();
			await persistent.close();
		}
	});
});
