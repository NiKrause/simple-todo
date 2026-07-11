import { test, expect } from '@playwright/test';

const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
const collaborationTimeout = 90000;

test.describe.serial('WebRTC transport toggle', () => {
	test.skip(
		!!process.env.BROWSERSTACK_BUILD_NAME,
		'Collaboration tests require the local relay-backed Playwright server.'
	);

	test('keeps browser peers connected through relay when WebRTC is disabled', async ({
		browser
	}) => {
		test.setTimeout(collaborationTimeout * 3);
		const session = await createAliceAndBob(browser);

		try {
			const { alice, bob } = session;

			await openReadyApp(alice);
			await expectWebRTCToggleState(alice, true);
			await setWebRTCToggle(alice, false);
			const alicePeerId = await getPeerId(alice);
			await waitForSelfDialableAddress(alice, 'Alice');

			await openReadyApp(bob);
			await expectWebRTCToggleState(bob, true);
			await setWebRTCToggle(bob, false);
			const bobPeerId = await getPeerId(bob);
			await waitForSelfDialableAddress(bob, 'Bob');

			await waitForPubsubDiscoveredDialablePeer(bob, alicePeerId, 'Bob -> Alice');
			await waitForPubsubDiscoveredDialablePeer(alice, bobPeerId, 'Alice -> Bob');
			await waitForConnectedPeer(bob, alicePeerId, 'Bob -> Alice');
			await waitForConnectedPeer(alice, bobPeerId, 'Alice -> Bob');
			await waitForConnectionCount(bob, 2);
			await expectRelayOnlyTransportState(alice, bobPeerId, 'Alice UI -> Bob');
			await expectRelayOnlyTransportState(bob, alicePeerId, 'Bob UI -> Alice');

			await bob.waitForTimeout(10_000);
			await expectRelayOnlyTransportState(alice, bobPeerId, 'Alice stable UI -> Bob');
			await expectRelayOnlyTransportState(bob, alicePeerId, 'Bob stable UI -> Alice');
		} finally {
			await session.close();
		}
	});
});

test.describe.serial('Todo collaboration', () => {
	test.skip(
		!!process.env.BROWSERSTACK_BUILD_NAME,
		'Collaboration tests require the local relay-backed Playwright server.'
	);

	/** @type {Awaited<ReturnType<typeof createAliceAndBob>> | null} */
	let session = null;
	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const bobTodoInAliceDb = `bob-${runId}-todo-in-alice-db`;
	const aliceTodoInBobDb = `alice-${runId}-todo-in-bob-db`;
	let aliceDefaultTodoDbAddress = '';
	let bobDefaultTodoDbAddress = '';

	test.beforeAll(async ({ browser }) => {
		session = await createAliceAndBob(browser);
	});

	test.afterAll(async () => {
		await session?.close();
	});

	test('Alice and Bob start with different OrbitDB todo addresses', async () => {
		test.setTimeout(collaborationTimeout * 4);
		const { alice, bob } = requireSession(session);

		await openReadyApp(alice);
		const alicePeerId = await getPeerId(alice);
		await waitForSelfDialableAddress(alice, 'Alice');

		await openReadyApp(bob);
		const bobPeerId = await getPeerId(bob);
		await waitForSelfDialableAddress(bob, 'Bob');
		await waitForPubsubDiscoveredDialablePeer(bob, alicePeerId, 'Bob -> Alice');
		await waitForPubsubDiscoveredDialablePeer(alice, bobPeerId, 'Alice -> Bob');
		await waitForConnectedPeer(bob, alicePeerId, 'Bob -> Alice');
		await waitForConnectedPeer(alice, bobPeerId, 'Alice -> Bob');
		await waitForConnectionCount(bob, 2);
		await expectRelayAndWebRTCTransportState(alice, bobPeerId, 'Alice UI -> Bob');
		await expectRelayAndWebRTCTransportState(bob, alicePeerId, 'Bob UI -> Alice');

		aliceDefaultTodoDbAddress = await getTodoDbAddress(alice);
		bobDefaultTodoDbAddress = await getTodoDbAddress(bob);
		expect(aliceDefaultTodoDbAddress).not.toBe(bobDefaultTodoDbAddress);

		const aliceIdentity = await getOrbitDBIdentity(alice);
		const bobIdentity = await getOrbitDBIdentity(bob);
		expect(aliceIdentity?.id).toBeTruthy();
		expect(bobIdentity?.id).toBeTruthy();
		expect(aliceIdentity?.id).not.toBe(bobIdentity?.id);
	});

	test('Bob opens Alice todo database and Alice sees Bob todo', async () => {
		test.setTimeout(collaborationTimeout * 3);
		const { alice, bob } = requireSession(session);
		const alicePeerId = await getPeerId(alice);
		const bobPeerId = await getPeerId(bob);

		await waitForConnectedPeer(bob, alicePeerId, 'Bob -> Alice');
		await waitForConnectedPeer(alice, bobPeerId, 'Alice -> Bob');
		await waitForConnectionCount(bob, 2);
		await loadTodoDb(bob, aliceDefaultTodoDbAddress);
		await Promise.all([
			waitForOrbitDBPeer(alice, bobPeerId, 'Alice OrbitDB sync -> Bob'),
			waitForOrbitDBPeer(bob, alicePeerId, 'Bob OrbitDB sync -> Alice')
		]);
		await addTodo(bob, bobTodoInAliceDb);
		await expectTodoWithReplicationPoll(alice, bobTodoInAliceDb);
	});

	test('Alice opens Bob todo database and Bob sees Alice todo', async () => {
		test.setTimeout(collaborationTimeout * 3);
		const { alice, bob } = requireSession(session);
		const alicePeerId = await getPeerId(alice);
		const bobPeerId = await getPeerId(bob);

		await waitForConnectedPeer(bob, alicePeerId, 'Bob -> Alice');
		await waitForConnectedPeer(alice, bobPeerId, 'Alice -> Bob');
		await waitForConnectionCount(bob, 2);
		await loadTodoDb(bob, bobDefaultTodoDbAddress);
		await loadTodoDb(alice, bobDefaultTodoDbAddress);
		await Promise.all([
			waitForOrbitDBPeer(alice, bobPeerId, 'Alice OrbitDB sync -> Bob'),
			waitForOrbitDBPeer(bob, alicePeerId, 'Bob OrbitDB sync -> Alice')
		]);
		await addTodo(alice, aliceTodoInBobDb);
		await expectTodoWithReplicationPoll(bob, aliceTodoInBobDb);
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
 * @param {boolean} enabled
 */
async function setWebRTCToggle(page, enabled) {
	const toggle = page.getByTestId('webrtc-toggle-button');
	await expect(toggle).toBeVisible({ timeout: collaborationTimeout });

	const currentValue = (await toggle.getAttribute('aria-checked')) === 'true';
	if (currentValue !== enabled) {
		const previousPeerId = await getPeerId(page);
		await toggle.click();
		await expect(page.getByTestId('todo-input')).toBeEnabled({ timeout: collaborationTimeout });
		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const hooks = window.__simpleTodoE2E;
						return hooks?.getPeerId?.() ?? null;
					}),
				{ timeout: collaborationTimeout }
			)
			.not.toBe(previousPeerId);
	}

	await expectWebRTCToggleState(page, enabled);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {boolean} enabled
 */
async function expectWebRTCToggleState(page, enabled) {
	await expect(page.getByTestId('webrtc-toggle-button')).toHaveAttribute(
		'aria-checked',
		String(enabled),
		{ timeout: collaborationTimeout }
	);
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
async function getActiveTodoDbAddress(page) {
	const address = await page.evaluate(() => {
		if (typeof window.getTodoDatabaseAddress !== 'function') return null;
		return window.getTodoDatabaseAddress();
	});

	if (typeof address !== 'string' || !address) {
		throw new Error('Timed out waiting for active Todo DB address.');
	}

	return address;
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
 * @returns {Promise<{ id?: string, publicKey?: string, hash?: string, type?: string } | null>}
 */
async function getOrbitDBIdentity(page) {
	return page.evaluate(() => {
		const hooks = window.__simpleTodoE2E;
		if (!hooks?.getOrbitDBIdentity) return null;
		return hooks.getOrbitDBIdentity();
	});
}

async function waitForOrbitDBPeer(page, peerId, label) {
	await expect
		.poll(
			() =>
				page.evaluate(
					(expectedPeerId) =>
						window.__simpleTodoDiagnostics?.getDatabasePeers?.().includes(expectedPeerId) ?? false,
					peerId
				),
			{ message: label, timeout: collaborationTimeout }
		)
		.toBe(true);
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
	await page.evaluate(async (todoDbAddress) => {
		if (typeof window.loadTodoDatabase !== 'function') {
			throw new Error('Todo database load hook is not available.');
		}
		await window.loadTodoDatabase(todoDbAddress);
	}, address);
	await expect
		.poll(() => getActiveTodoDbAddress(page), { timeout: collaborationTimeout })
		.toBe(address);
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
async function waitForConnectedPeer(page, peerId, label) {
	await waitForP2PState(page, `${label} connection`, (state) =>
		state.connectedPeerIds.includes(peerId)
	);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} remoteBrowserPeerId
 * @param {string} label
 */
async function expectRelayAndWebRTCTransportState(page, remoteBrowserPeerId, label) {
	await waitForP2PState(page, `${label} relay and WebRTC transport state`, (state) => {
		const relayConnection = state.connections.some(
			(connection) =>
				connection.remotePeer !== remoteBrowserPeerId && connection.remoteAddr?.includes('/ws/')
		);
		const remoteBrowserRelayConnection = state.connections.some(
			(connection) =>
				connection.remotePeer === remoteBrowserPeerId &&
				connection.remoteAddr?.includes('/p2p-circuit')
		);
		const remoteBrowserWebRTCConnection = state.connections.some(
			(connection) =>
				connection.remotePeer === remoteBrowserPeerId && connection.remoteAddr?.includes('/webrtc')
		);

		return relayConnection && remoteBrowserRelayConnection && remoteBrowserWebRTCConnection;
	});

	await expectPeerTransportBadge(
		page,
		remoteBrowserPeerId,
		'circuit-relay',
		`${label} Relay badge`
	);
	await expectPeerTransportBadge(page, remoteBrowserPeerId, 'webrtc', `${label} WebRTC badge`);
	await expect(page.getByTestId('transport-badge').filter({ hasText: 'WS' })).toBeVisible({
		timeout: collaborationTimeout
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} remoteBrowserPeerId
 * @param {string} label
 */
async function expectRelayOnlyTransportState(page, remoteBrowserPeerId, label) {
	await waitForP2PState(page, `${label} relay-only transport state`, (state) => {
		const relayConnection = state.connections.some(
			(connection) =>
				connection.remotePeer !== remoteBrowserPeerId && connection.remoteAddr?.includes('/ws/')
		);
		const remoteBrowserRelayConnection = state.connections.some(
			(connection) =>
				connection.remotePeer === remoteBrowserPeerId &&
				connection.remoteAddr?.includes('/p2p-circuit')
		);
		const remoteBrowserWebRTCConnection = state.connections.some(
			(connection) =>
				connection.remotePeer === remoteBrowserPeerId && connection.remoteAddr?.includes('/webrtc')
		);

		return relayConnection && remoteBrowserRelayConnection && !remoteBrowserWebRTCConnection;
	});

	await expectPeerTransportBadge(
		page,
		remoteBrowserPeerId,
		'circuit-relay',
		`${label} Relay badge`
	);
	await expectNoPeerTransportBadge(page, remoteBrowserPeerId, 'webrtc', `${label} no WebRTC badge`);
	await expect(page.getByTestId('transport-badge').filter({ hasText: 'WS' })).toBeVisible({
		timeout: collaborationTimeout
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} peerId
 * @param {string} transport
 * @param {string} label
 */
async function expectPeerTransportBadge(page, peerId, transport, label) {
	await expect(
		page
			.getByTestId('transport-badge')
			.and(page.locator(`[data-peer-id="${peerId}"][data-transport="${transport}"]`)),
		label
	).toBeVisible({ timeout: collaborationTimeout });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} peerId
 * @param {string} transport
 * @param {string} label
 */
async function expectNoPeerTransportBadge(page, peerId, transport, label) {
	await expect(
		page
			.getByTestId('transport-badge')
			.and(page.locator(`[data-peer-id="${peerId}"][data-transport="${transport}"]`)),
		label
	).toHaveCount(0, { timeout: collaborationTimeout });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} peerId
 * @param {string} label
 */
async function waitForPubsubDiscoveredDialablePeer(page, peerId, label) {
	await waitForP2PState(page, `${label} pubsub discovery`, (state) => {
		if (state.connectedPeerIds.includes(peerId)) return true;

		const peer = state.discoveredPeers.find((peer) => peer.peerId === peerId);
		return peer?.multiaddrs.some(isDialableBrowserAddress) ?? false;
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function waitForSelfDialableAddress(page, label) {
	await waitForP2PState(page, `${label} dialable self address`, (state) =>
		state.multiaddrs.some(isDialableBrowserAddress)
	);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} minimumCount
 */
async function waitForConnectionCount(page, minimumCount) {
	await waitForP2PState(
		page,
		`at least ${minimumCount} P2P connections`,
		(state) => state.connectionCount >= minimumCount
	);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} description
 * @param {(state: Awaited<ReturnType<typeof getP2PState>>) => boolean} predicate
 */
async function waitForP2PState(page, description, predicate) {
	const deadline = Date.now() + collaborationTimeout;
	let lastState = await getP2PState(page);

	while (Date.now() < deadline) {
		lastState = await getP2PState(page);
		if (predicate(lastState)) return;
		await page.waitForTimeout(1000);
	}

	throw new Error(
		`Timed out waiting for ${description}. Last P2P state:\n${JSON.stringify(lastState, null, 2)}`
	);
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function getP2PState(page) {
	return page.evaluate(() => {
		const hooks = window.__simpleTodoE2E;

		return {
			peerId: hooks?.getPeerId?.() ?? null,
			multiaddrs: hooks?.getMultiaddrs?.() ?? [],
			connectionCount: hooks?.getConnectionCount?.() ?? 0,
			connectedPeerIds: hooks?.getConnectedPeerIds?.() ?? [],
			connections: hooks?.getConnections?.() ?? [],
			discoveredPeers: hooks?.getDiscoveredPeers?.() ?? []
		};
	});
}

/**
 * @param {string} address
 */
function isDialableBrowserAddress(address) {
	const normalizedAddress = address.toLowerCase();
	const usesBrowserReachableTransport =
		normalizedAddress.includes('/ws') ||
		normalizedAddress.includes('/wss') ||
		normalizedAddress.includes('/webrtc') ||
		normalizedAddress.includes('/webrtc-direct');

	return (
		normalizedAddress.includes('/p2p/') &&
		usesBrowserReachableTransport &&
		(normalizedAddress.includes('/p2p-circuit') ||
			normalizedAddress.includes('/webrtc') ||
			normalizedAddress.includes('/webrtc-direct') ||
			normalizedAddress.includes('/ws') ||
			normalizedAddress.includes('/wss'))
	);
}
