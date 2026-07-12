import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

const timeout = 120_000;

test.describe('Relay store-and-forward replication', () => {
	test('a fresh Bob restores Alice history after Alice disconnects', async ({ browser }) => {
		test.setTimeout(timeout * 3);
		const relayInfo = JSON.parse(await readFile('e2e/relay-info.json', 'utf8'));
		const relayOrigin = relayInfo.httpOrigin;
		expect(relayOrigin).toMatch(/^http:\/\/127\.0\.0\.1:/);

		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const todo = `store-forward-${runId}-from-alice`;
		const aliceContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		let bobContext;

		try {
			await openReadyApp(alice);
			const databaseAddress = await activeDatabaseAddress(alice);
			await addTodo(alice, todo);

			const relayEvidence = await syncRelay(relayOrigin, databaseAddress, todo);
			expect(relayEvidence.sync.receivedUpdate).toBe(true);
			expect(relayEvidence.sync.lastRecord.payloadPreview).toContain(`text: '${todo}'`);
			expect(relayEvidence.database.lastRecord.payloadPreview).toContain(`text: '${todo}'`);

			// Alice must be gone before Bob exists, otherwise this only proves live peer replication.
			await aliceContext.close();

			bobContext = await browser.newContext();
			const bob = await bobContext.newPage();
			await openReadyApp(bob);
			await loadDatabase(bob, databaseAddress);
			await expectTodoWithPolling(bob, todo);
		} finally {
			await bobContext?.close();
			if (aliceContext.pages().length > 0) await aliceContext.close();
		}
	});
});

async function openReadyApp(page) {
	await page.goto('/');
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();
	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	await page.getByRole('button', { name: 'Proceed to Test the App' }).click();
	await expect(page.getByTestId('todo-input')).toBeEnabled({ timeout });
	await expect(page.getByTestId('load-todo-db-input')).toHaveValue(/^\/orbitdb\//, { timeout });
}

async function activeDatabaseAddress(page) {
	return page.evaluate(() => window.getTodoDatabaseAddress());
}

async function addTodo(page, text) {
	await page.getByTestId('todo-input').fill(text);
	await page.getByTestId('add-todo-button').click();
	await expect(page.getByTestId('todo-item').filter({ hasText: text })).toBeVisible({ timeout });
}

async function loadDatabase(page, address) {
	await page.evaluate(async (databaseAddress) => window.loadTodoDatabase(databaseAddress), address);
	await expect.poll(() => activeDatabaseAddress(page), { timeout }).toBe(address);
}

async function expectTodoWithPolling(page, text) {
	await expect
		.poll(
			async () => {
				await page.evaluate(() => window.forceReloadTodos());
				return page.getByTestId('todo-item').filter({ hasText: text }).count();
			},
			{ timeout, intervals: [1_000, 2_000, 5_000] }
		)
		.toBeGreaterThan(0);
}

async function syncRelay(origin, databaseAddress, expectedTodo) {
	const syncResponse = await fetch(`${origin}/pinning/sync`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ dbAddress: databaseAddress }),
		signal: AbortSignal.timeout(timeout)
	});
	const sync = await syncResponse.json();
	expect(syncResponse.ok, JSON.stringify(sync)).toBe(true);
	expect(sync.ok).toBe(true);
	expect(sync.lastRecord?.payloadPreview).toContain(`text: '${expectedTodo}'`);

	const databasesResponse = await fetch(
		`${origin}/pinning/databases?address=${encodeURIComponent(databaseAddress)}`,
		{ signal: AbortSignal.timeout(20_000) }
	);
	const databases = await databasesResponse.json();
	expect(databasesResponse.ok, JSON.stringify(databases)).toBe(true);
	const database = databases.databases?.find((item) => item.address === databaseAddress);
	expect(database).toBeTruthy();
	return { sync, database };
}
