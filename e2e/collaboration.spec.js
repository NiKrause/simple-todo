import { test, expect } from '@playwright/test';

const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
const collaborationTimeout = 90000;
const currentReplicationGap =
	'Known gap: local browser nodes currently expose no dialable libp2p multiaddrs, so Bob cannot sync Alice todos by DB address yet.';

/**
 * @param {import('@playwright/test').Page} page
 */
async function openReadyApp(page) {
	await page.goto(testUrl);

	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();

	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}

	await page.getByRole('button', { name: 'Proceed to Test the App' }).click();
	await expect(modal).not.toBeVisible();
	await expect(page.getByTestId('todo-input')).toBeEnabled({ timeout: collaborationTimeout });
	await expect(page.getByTestId('load-todo-db-input')).toHaveValue(/^\/orbitdb\//, {
		timeout: collaborationTimeout
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
async function getTodoDbAddress(page) {
	const input = page.getByTestId('load-todo-db-input');
	await expect(input).toHaveValue(/^\/orbitdb\//, { timeout: collaborationTimeout });
	return input.inputValue();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	await page.getByTestId('todo-input').fill(text);
	await page.getByTestId('add-todo-button').click();
	await expectTodo(page, text);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} address
 */
async function loadTodoDb(page, address) {
	await page.getByTestId('load-todo-db-input').fill(address);
	await page.getByTestId('load-todo-db-button').click();
	await expect(page.getByTestId('load-todo-db-input')).toHaveValue(address, {
		timeout: collaborationTimeout
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectTodo(page, text) {
	await expect(page.getByTestId('todo-item').filter({ hasText: text })).toBeVisible({
		timeout: collaborationTimeout
	});
}

/**
 * @param {import('@playwright/test').Browser} browser
 */
async function createAliceAndBob(browser) {
	const aliceContext = await browser.newContext();
	const bobContext = await browser.newContext();
	const alice = await aliceContext.newPage();
	const bob = await bobContext.newPage();

	return {
		alice,
		bob,
		close: async () => {
			await bobContext.close();
			await aliceContext.close();
		}
	};
}

test.describe('Todo collaboration', () => {
	test.skip(
		!!process.env.BROWSERSTACK_BUILD_NAME,
		'Collaboration tests require local VITE_E2E libp2p hooks.'
	);

	test('Bob loads Alice todo database and sees Alice todos', async ({ browser }, testInfo) => {
		test.setTimeout(collaborationTimeout * 3);
		test.fail(true, currentReplicationGap);

		const session = await createAliceAndBob(browser);

		try {
			const runId = `${testInfo.workerIndex}-${Date.now()}`;
			const aliceTodos = [
				`alice-${runId}-todo-1`,
				`alice-${runId}-todo-2`,
				`alice-${runId}-todo-3`
			];

			await openReadyApp(session.alice);
			for (const todo of aliceTodos) {
				await addTodo(session.alice, todo);
			}

			const aliceTodoDbAddress = await getTodoDbAddress(session.alice);

			await openReadyApp(session.bob);
			await connectBobToAlice(session.alice, session.bob);
			await loadTodoDb(session.bob, aliceTodoDbAddress);

			for (const todo of aliceTodos) {
				await expectTodo(session.bob, todo);
			}
		} finally {
			await session.close();
		}
	});

	test('Alice sees Bob todo immediately after Bob loads Alice database', async ({
		browser
	}, testInfo) => {
		test.setTimeout(collaborationTimeout * 3);
		test.fail(true, currentReplicationGap);

		const session = await createAliceAndBob(browser);

		try {
			const runId = `${testInfo.workerIndex}-${Date.now()}`;
			const aliceTodos = [
				`alice-${runId}-handoff-1`,
				`alice-${runId}-handoff-2`,
				`alice-${runId}-handoff-3`
			];
			const bobTodo = `bob-${runId}-replicated-todo`;

			await openReadyApp(session.alice);
			for (const todo of aliceTodos) {
				await addTodo(session.alice, todo);
			}

			const aliceTodoDbAddress = await getTodoDbAddress(session.alice);

			await openReadyApp(session.bob);
			await connectBobToAlice(session.alice, session.bob);
			await loadTodoDb(session.bob, aliceTodoDbAddress);

			for (const todo of aliceTodos) {
				await expectTodo(session.bob, todo);
			}

			await addTodo(session.bob, bobTodo);
			await expectTodo(session.alice, bobTodo);
		} finally {
			await session.close();
		}
	});
});

/**
 * @param {import('@playwright/test').Page} alice
 * @param {import('@playwright/test').Page} bob
 */
async function connectBobToAlice(alice, bob) {
	const aliceAddrs = await waitForDialableMultiaddrs(alice);
	/** @type {unknown[]} */
	const dialErrors = [];

	for (const address of aliceAddrs) {
		const result = await bob.evaluate(async (multiaddr) => {
			const hooks = window.__simpleTodoE2E;
			if (!hooks?.connectToMultiaddr) {
				throw new Error('Missing local E2E libp2p hooks.');
			}

			try {
				return await hooks.connectToMultiaddr(multiaddr);
			} catch (error) {
				return { error: error instanceof Error ? error.message : String(error) };
			}
		}, address);

		if (!result?.error && result?.status === 'stable') {
			await waitForConnection(bob);
			return;
		}

		dialErrors.push({ address, result });
	}

	throw new Error(`Bob could not dial Alice. Attempts: ${JSON.stringify(dialErrors, null, 2)}`);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
async function waitForDialableMultiaddrs(page) {
	const deadline = Date.now() + collaborationTimeout;

	while (Date.now() < deadline) {
		const addresses = await page.evaluate(() => {
			const hooks = window.__simpleTodoE2E;
			if (!hooks?.getMultiaddrs) return [];
			return hooks.getMultiaddrs();
		});
		const dialableAddresses = addresses.filter((address) => address.includes('/p2p/'));

		if (dialableAddresses.length > 0) {
			return dialableAddresses;
		}

		await page.waitForTimeout(1000);
	}

	throw new Error('Timed out waiting for Alice dialable libp2p multiaddrs.');
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForConnection(page) {
	await expect
		.poll(
			() =>
				page.evaluate(() => {
					const hooks = window.__simpleTodoE2E;
					if (!hooks?.getConnectionCount) return 0;
					return hooks.getConnectionCount();
				}),
			{ timeout: collaborationTimeout }
		)
		.toBeGreaterThan(0);
}
