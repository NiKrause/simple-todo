import { test, expect } from '@playwright/test';
import { isConsentOpen, passConsent, waitForConsent } from './consent.mjs';

const timeout = 90000;

/**
 * The claim the storage choice makes, in both directions.
 *
 * This chapter ran in memory unconditionally and never said so — a reload
 * emptied everything, which is also what made an offline test measure the
 * wrong thing (see the `fixme` block in delegation.spec.js). Asserting both
 * halves, because "keeps them" is only meaningful next to "does not".
 */
async function openWith(page, mode) {
	await page.goto('/');
	await waitForConsent(page);
	await page.getByTestId(`storage-mode-${mode}`).check();
	await passConsent(page);
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

async function reopen(page) {
	await page.reload();

	// The dialog may not come back at all — whether it does is the app's
	// business, not this test's. Waiting for it to reappear is what made this
	// fail the first time: on the helper, not on storage. Asked of the element
	// rather than measured, because the host is 0x0 once it upgrades.
	await page
		.waitForFunction(
			() => document.querySelector('[data-testid="consent-modal"]')?.isOpen === true,
			undefined,
			{ timeout: 10_000 }
		)
		.catch(() => {});
	if (await isConsentOpen(page)) await passConsent(page);

	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
}

test.describe('Where your todos are stored', () => {
	test('kept in this browser: a todo survives a reload', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await openWith(page, 'indexeddb');

		const todo = `kept-${Date.now().toString(36)}`;
		await page.getByPlaceholder('What needs to be done?').fill(todo);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });

		await reopen(page);
		await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });
	});

	test('in memory only: nothing is written to this device', async ({ page }) => {
		test.setTimeout(timeout * 4);
		await openWith(page, 'memory');

		const todo = `gone-${Date.now().toString(36)}`;
		await page.getByPlaceholder('What needs to be done?').fill(todo);
		await page.getByRole('button', { name: 'Add TODO' }).click();
		await expect(page.getByText(todo, { exact: true })).toBeVisible({ timeout });

		// What the choice promises is about this device, so it is checked on this
		// device: no IndexedDB database of ours may exist at all. A todo that
		// merely failed to render would pass a weaker assertion.
		const ours = await page.evaluate(async () =>
			(await indexedDB.databases())
				.map((d) => d.name ?? '')
				.filter((n) => n.includes('simple-todo'))
		);
		expect(ours).toEqual([]);
	});
});
