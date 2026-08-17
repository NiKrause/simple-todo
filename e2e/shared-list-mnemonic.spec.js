import { test, expect } from '@playwright/test';
import { seedIntroDismissed } from './open-app.mjs';

const testUrl = '/';
const timeout = 90000;

test.describe('Spanish mnemonic shared todo lists', () => {
	// Needs rewriting for qr01, and deliberately not rushed.
	//
	// This spec drives the mnemonic selector *inside the consent modal*:
	// generate, copy, paste into two more browsers, then open. qr01 deletes that
	// modal — a mnemonic is generated on mount and changed through the in-app
	// editor behind "Open another shared list", which sits inside the
	// `network-details` panel.
	//
	// That is not a locator swap. The spec also asserts `network-details` is
	// *closed* after the lists are opened, which cannot hold once reaching the
	// editor means expanding that very panel. Deciding what it should assert now
	// is a rewrite, and marking it beats leaving a spec that fails for reasons
	// unrelated to the behaviour it covers.
	//
	// The behaviour itself is unchanged and still exercised by
	// `default-database-collaboration.spec.js`, which opens a mnemonic list and
	// replicates across two browsers.
	test.fixme(
		'two browsers join the copied mnemonic while a different mnemonic stays isolated',
		async ({ browser }) => {
			test.setTimeout(timeout * 3);
			const aliceContext = await browser.newContext({
				permissions: ['clipboard-read', 'clipboard-write']
			});
			const bobContext = await browser.newContext();
			const isolatedContext = await browser.newContext();
			const alice = await aliceContext.newPage();
			const bob = await bobContext.newPage();
			const isolated = await isolatedContext.newPage();
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const aliceTodo = `mnemonic-${runId}-from-alice`;
			const bobTodo = `mnemonic-${runId}-from-bob`;

			try {
				const aliceModal = await openSelection(alice);
				const selector = aliceModal.getByTestId('shared-list-selector');
				await selector.getByRole('button', { name: 'Generate new' }).click();
				const aliceMnemonic = await selector.getByTestId('shared-list-mnemonic-input').inputValue();
				await selector.getByRole('button', { name: 'Copy', exact: true }).click();
				await expect(selector.getByRole('button', { name: 'Copied!', exact: true })).toBeVisible();
				const copiedMnemonic = await alice.evaluate(() => navigator.clipboard.readText());
				expect(copiedMnemonic).toBe(aliceMnemonic);

				const [bobModal, isolatedModal] = await Promise.all([
					openSelection(bob),
					openSelection(isolated)
				]);
				await bobModal.getByTestId('shared-list-mnemonic-input').fill(copiedMnemonic);
				const isolatedMnemonic =
					copiedMnemonic === 'agua-aire-alba' ? 'sol-camino-verde' : 'agua-aire-alba';
				await isolatedModal.getByTestId('shared-list-mnemonic-input').fill(isolatedMnemonic);

				await Promise.all([
					openSelectedList(alice),
					openSelectedList(bob),
					openSelectedList(isolated)
				]);

				const [aliceDetails, bobDetails, isolatedDetails] = [alice, bob, isolated].map((page) =>
					page.getByTestId('shared-list-details')
				);
				for (const details of [aliceDetails, bobDetails, isolatedDetails]) {
					await expect(details).not.toHaveAttribute('open', '');
					await expect(details).toBeVisible();
					await expect(
						details.locator('xpath=ancestor::nav[@data-testid="p2p-status-nav"]')
					).toHaveCount(1);
				}
				await expect(alice.getByTestId('network-details')).not.toHaveAttribute('open', '');
				await aliceDetails.getByText('Shared list', { exact: true }).click();
				await bobDetails.getByText('Shared list', { exact: true }).focus();
				await bob.keyboard.press('Enter');
				await expect(aliceDetails.getByTestId('active-shared-list-name')).toHaveText(
					copiedMnemonic
				);
				await expect(bobDetails.getByTestId('active-shared-list-name')).toHaveText(copiedMnemonic);

				const [aliceDatabase, bobDatabase, isolatedDatabase] = await Promise.all([
					getDatabaseDiagnostics(alice),
					getDatabaseDiagnostics(bob),
					getDatabaseDiagnostics(isolated)
				]);
				expect(aliceDatabase.name).toBe(copiedMnemonic);
				expect(bobDatabase.name).toBe(copiedMnemonic);
				expect(aliceDatabase.address).toBe(bobDatabase.address);
				expect(isolatedDatabase.name).toBe(isolatedMnemonic);
				expect(isolatedDatabase.address).not.toBe(aliceDatabase.address);

				await addTodo(alice, aliceTodo);
				await expectTodo(bob, aliceTodo);
				await addTodo(bob, bobTodo);
				await expectTodo(alice, bobTodo);
				await expect(isolated.getByText(aliceTodo, { exact: true })).toHaveCount(0);
				await expect(isolated.getByText(bobTodo, { exact: true })).toHaveCount(0);
			} finally {
				await Promise.all([isolatedContext.close(), bobContext.close(), aliceContext.close()]);
			}
		}
	);
});

/** @param {import('@playwright/test').Page} page */
async function openSelection(page) {
	// Seeded here rather than in a `beforeEach`: this spec builds its own
	// contexts and pages, so a hook on the `page` fixture would dismiss the
	// dialog for a page nobody uses and leave the real ones covered by it.
	await seedIntroDismissed(page);
	await page.goto(testUrl);
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();
	await expect(modal.getByTestId('shared-list-mnemonic-input')).toHaveValue(/.+-.+-.+/);
	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	return modal;
}

/** @param {import('@playwright/test').Page} page */
async function openSelectedList(page) {
	await page.getByRole('button', { name: 'Open shared list' }).click();
	await expect(page.locator('div.fixed.inset-0.z-50')).not.toBeVisible();
	await expect(page.getByTestId('todo-input')).toBeEnabled({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function getDatabaseDiagnostics(page) {
	await expect
		.poll(
			() =>
				page.evaluate(() => ({
					name: window.__simpleTodoE2E?.getDatabaseName?.() ?? '',
					address: window.__simpleTodoE2E?.getDatabaseAddress?.() ?? ''
				})),
			{ timeout }
		)
		.toMatchObject({ name: expect.any(String), address: expect.stringContaining('/orbitdb/') });
	return page.evaluate(() => ({
		name: window.__simpleTodoE2E.getDatabaseName(),
		address: window.__simpleTodoE2E.getDatabaseAddress()
	}));
}

/** @param {import('@playwright/test').Page} page @param {string} text */
async function addTodo(page, text) {
	await page.getByTestId('todo-input').fill(text);
	await page.getByTestId('todo-add').click();
	await expectTodo(page, text);
}

/** @param {import('@playwright/test').Page} page @param {string} text */
async function expectTodo(page, text) {
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}
