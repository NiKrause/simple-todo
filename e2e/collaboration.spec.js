import { test, expect } from '@playwright/test';

const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
const collaborationTimeout = 90000;

test.describe.serial('Todo collaboration', () => {
	test.skip(
		!!process.env.BROWSERSTACK_BUILD_NAME,
		'Collaboration tests require the local relay-backed Playwright server.'
	);

	/** @type {Awaited<ReturnType<typeof createAliceAndBob>> | null} */
	let session = null;
	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const aliceTodos = [`alice-${runId}-todo-1`, `alice-${runId}-todo-2`, `alice-${runId}-todo-3`];
	const bobTodo = `bob-${runId}-replicated-todo`;

	test.beforeAll(async ({ browser }) => {
		session = await createAliceAndBob(browser);
	});

	test.afterAll(async () => {
		await session?.close();
	});

	test('Bob loads Alice todo database and sees Alice todos', async () => {
		test.setTimeout(collaborationTimeout * 4);
		const { alice, bob } = requireSession(session);

		await openReadyApp(alice);
		const alicePeerId = await getPeerId(alice);
		for (const todo of aliceTodos) {
			await addTodo(alice, todo);
		}

		const aliceTodoDbAddress = await getTodoDbAddress(alice);

		await openReadyApp(bob);
		const bobPeerId = await getPeerId(bob);
		await waitForPubsubDiscoveredDialablePeer(bob, alicePeerId);
		await waitForConnectedPeer(bob, alicePeerId);
		await waitForConnectedPeer(alice, bobPeerId);
		await waitForConnectionCount(bob, 2);
		await bob.waitForTimeout(5000);
		await loadTodoDb(bob, aliceTodoDbAddress);
		await bob.waitForTimeout(5000);
		await announceTodoDatabaseEntries(alice, { attempts: 3, delayMs: 3000 });

		for (const todo of aliceTodos) {
			await expectTodoWithReplicationPoll(bob, todo);
		}
	});

	test('Alice sees Bob todo immediately after Bob loads Alice database', async () => {
		test.setTimeout(collaborationTimeout * 3);
		const { alice, bob } = requireSession(session);

		for (const todo of aliceTodos) {
			await expectTodoWithReplicationPoll(bob, todo);
		}

		await addTodo(bob, bobTodo);
		await announceTodoDatabaseEntries(bob, { attempts: 3, delayMs: 3000 });
		await expectTodoWithReplicationPoll(alice, bobTodo);
	});
});

/**
 * @param {Awaited<ReturnType<typeof createAliceAndBob>> | null} session
 */
function requireSession(session) {
	if (!session) throw new Error('Alice/Bob session was not created.');
	return session;
}

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
 * @returns {Promise<string>}
 */
async function getPeerId(page) {
	const peerId = await page.evaluate(() => {
		const hooks = window.__simpleTodoE2E;
		if (!hooks?.getPeerId) return null;
		return hooks.getPeerId();
	});

	if (typeof peerId !== 'string' || !peerId) {
		throw new Error('Timed out waiting for page peer id.');
	}

	return peerId;
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
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectTodoWithReplicationPoll(page, text) {
	const deadline = Date.now() + collaborationTimeout;

	while (Date.now() < deadline) {
		await page.evaluate(async () => {
			if (typeof window.forceReloadTodos === 'function') {
				await window.forceReloadTodos();
			}
		});

		try {
			await expect(page.getByTestId('todo-item').filter({ hasText: text })).toBeVisible({
				timeout: 5000
			});
			return;
		} catch {
			await page.waitForTimeout(2000);
		}
	}

	await expectTodo(page, text);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ attempts?: number, delayMs?: number }} [options]
 */
async function announceTodoDatabaseEntries(page, { attempts = 1, delayMs = 0 } = {}) {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		await expect
			.poll(
				() =>
					page.evaluate(async () => {
						if (typeof window.announceTodoDatabaseEntries !== 'function') return 0;
						return window.announceTodoDatabaseEntries();
					}),
				{ timeout: collaborationTimeout }
			)
			.toBeGreaterThan(0);

		if (attempt < attempts && delayMs > 0) {
			await page.waitForTimeout(delayMs);
		}
	}
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

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} peerId
 */
async function waitForConnectedPeer(page, peerId) {
	await expect
		.poll(
			() =>
				page.evaluate((expectedPeerId) => {
					const hooks = window.__simpleTodoE2E;
					if (!hooks?.getConnectedPeerIds) return false;
					return hooks.getConnectedPeerIds().includes(expectedPeerId);
				}, peerId),
			{ timeout: collaborationTimeout }
		)
		.toBe(true);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} peerId
 */
async function waitForPubsubDiscoveredDialablePeer(page, peerId) {
	await expect
		.poll(
			() =>
				page.evaluate((expectedPeerId) => {
					const hooks = window.__simpleTodoE2E;
					if (!hooks?.getDiscoveredPeers) return false;
					const peer = hooks.getDiscoveredPeers().find((peer) => peer.peerId === expectedPeerId);

					return (
						peer?.multiaddrs.some(
							(address) =>
								address.includes('/p2p/') &&
								(address.includes('/p2p-circuit') ||
									address.includes('/webrtc') ||
									address.includes('/ws'))
						) ?? false
					);
				}, peerId),
			{ timeout: collaborationTimeout }
		)
		.toBe(true);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} minimumCount
 */
async function waitForConnectionCount(page, minimumCount) {
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
		.toBeGreaterThanOrEqual(minimumCount);
}
