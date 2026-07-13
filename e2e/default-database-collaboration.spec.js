import { test, expect } from '@playwright/test';

const testUrl = '/';
const collaborationTimeout = 90000;
const sharedMnemonic = 'luna-camino-verde';

test.describe('Default todo database collaboration', () => {
	test('Alice and Bob share the default OrbitDB todo list', async ({ browser }) => {
		test.setTimeout(collaborationTimeout * 3);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const aliceTodos = [`alice-${runId}-todo-1`, `alice-${runId}-todo-2`, `alice-${runId}-todo-3`];
		const bobTodos = [`bob-${runId}-todo-1`, `bob-${runId}-todo-2`, `bob-${runId}-todo-3`];
		const allTodos = [...aliceTodos, ...bobTodos];

		try {
			await Promise.all([openReadyApp(alice), openReadyApp(bob)]);
			const [alicePeerId, bobPeerId] = await Promise.all([getPeerId(alice), getPeerId(bob)]);

			await Promise.all([
				expectWebRTCConnection(alice, bobPeerId),
				expectWebRTCConnection(bob, alicePeerId)
			]);
			await Promise.all([expectNetworkReady(alice), expectNetworkReady(bob)]);

			for (const todo of aliceTodos) {
				await addTodo(alice, todo);
				await expectTodo(bob, todo);
				await Promise.all([expectTodoRelayPinned(alice, todo), expectTodoRelayPinned(bob, todo)]);
			}

			for (const todo of bobTodos) {
				await addTodo(bob, todo);
				await expectTodo(alice, todo);
				await Promise.all([expectTodoRelayPinned(alice, todo), expectTodoRelayPinned(bob, todo)]);
			}

			for (const todo of allTodos) {
				await expectTodo(alice, todo);
				await expectTodo(bob, todo);
				await expectTodoRelayPinned(alice, todo);
				await expectTodoRelayPinned(bob, todo);
			}

			await Promise.all([expectTodoRelayTooltip(alice), expectTodoRelayTooltip(bob)]);
		} finally {
			await bobContext.close();
			await aliceContext.close();
		}
	});
});

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
	await modal.getByTestId('shared-list-mnemonic-input').fill(sharedMnemonic);

	await page.getByRole('button', { name: 'Open shared list' }).click();
	await expect(modal).not.toBeVisible();
	await expect(getTodoInput(page)).toBeVisible();
	await expect(getTodoInput(page)).toBeEnabled({ timeout: collaborationTimeout });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	await getTodoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expectTodo(page, text);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectTodo(page, text) {
	await expect(page.getByText(text, { exact: true })).toBeVisible({
		timeout: collaborationTimeout
	});
}

/** @param {import('@playwright/test').Page} page */
async function expectTodoRelayTooltip(page) {
	await page.getByTestId('todo-relay-status').first().hover();
	await expect(page.getByTestId('todo-relay-tooltip')).toBeVisible();
	await expect(page.getByTestId('todo-relay-tooltip')).toContainText('Relay replication:');
}

/**
 * Require an exact relay-side OrbitDB replication proof for the newly created entry.
 * An amber `unavailable` LED or a blue `pending` LED must fail this test.
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectTodoRelayPinned(page, text) {
	const todoItem = page.getByTestId('todo-item').filter({
		has: page.getByText(text, { exact: true })
	});
	await expect(todoItem.getByTestId('todo-relay-status')).toHaveAttribute('data-status', 'pinned', {
		timeout: collaborationTimeout
	});
}

/**
 * @param {import('@playwright/test').Page} page
 */
function getTodoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function getPeerId(page) {
	await expect
		.poll(() => page.evaluate(() => window.__simpleTodoE2E?.getPeerId?.() ?? null), {
			timeout: collaborationTimeout
		})
		.toBeTruthy();

	return page.evaluate(() => window.__simpleTodoE2E.getPeerId());
}

/**
 * Verify the relay-assisted browser-to-browser WebRTC connection created after
 * pubsub discovery. The address may still contain /p2p-circuit because the
 * relay provides signaling; /webrtc identifies the upgraded transport.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} remotePeerId
 */
async function expectWebRTCConnection(page, remotePeerId) {
	await expect
		.poll(
			() =>
				page.evaluate(
					(peerId) =>
						window.__simpleTodoE2E
							?.getConnections?.()
							.some(
								(connection) =>
									connection.remotePeer === peerId && connection.remoteAddr?.includes('/webrtc')
							) ?? false,
					remotePeerId
				),
			{ timeout: collaborationTimeout }
		)
		.toBe(true);

	const networkDetails = page.getByTestId('network-details');
	if ((await networkDetails.getAttribute('open')) === null) {
		await networkDetails.getByText('Network details', { exact: true }).click();
	}

	await expect(
		page.locator(
			`[data-testid="transport-badge"][data-peer-id="${remotePeerId}"][data-transport="webrtc"]`
		)
	).toBeVisible({ timeout: collaborationTimeout });
}

/** @param {import('@playwright/test').Page} page */
async function expectNetworkReady(page) {
	const steps = page.getByTestId('p2p-status-step');
	await expect(steps).toHaveCount(8);
	await expect(page.locator('[data-testid="p2p-status-step"][data-status="complete"]')).toHaveCount(
		8,
		{ timeout: collaborationTimeout }
	);
	await expect(page.getByTestId('p2p-status-spinner')).toHaveCount(0);

	await steps.first().hover();
	await expect(page.getByTestId('p2p-status-tooltip')).toContainText('Network config:');
}
