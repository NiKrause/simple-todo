import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
const collaborationTimeout = 90000;
const relayInfoUrl = new URL('./relay-info.json', import.meta.url);
const runRelayPinningProof = process.env.E2E_RELAY_PINNING_PROOF === 'true';

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
		const bobIdentity = await getOrbitDBIdentity(bob);
		await publishOrbitDBIdentity(bob);
		await waitForKnownOrbitDBIdentity(alice, bobIdentity?.hash, 'Alice knows Bob OrbitDB identity');
		await addTodo(bob, bobTodoInAliceDb);
		await announceTodoDatabaseEntries(bob, { attempts: 3, delayMs: 3000 });
		await transferTodoDatabaseEntries(bob, alice);
		await expectTodoWithReplicationPoll(alice, bobTodoInAliceDb, bob);
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
		const aliceIdentity = await getOrbitDBIdentity(alice);
		await publishOrbitDBIdentity(alice);
		await waitForKnownOrbitDBIdentity(bob, aliceIdentity?.hash, 'Bob knows Alice OrbitDB identity');
		await addTodo(alice, aliceTodoInBobDb);
		await announceTodoDatabaseEntries(alice, { attempts: 3, delayMs: 3000 });
		await transferTodoDatabaseEntries(alice, bob);
		await expectTodoWithReplicationPoll(bob, aliceTodoInBobDb, alice);
	});
});

test.describe.serial('Relay-pinned todo replication', () => {
	test.skip(
		!!process.env.BROWSERSTACK_BUILD_NAME,
		'Relay pinning tests require the relay-backed Playwright server.'
	);
	test.skip(
		!runRelayPinningProof,
		'Set E2E_RELAY_PINNING_PROOF=true to run relay-pinned proof tests.'
	);

	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

	test('Bob opens Alice database after the relay replicated Alice todo', async ({ browser }) => {
		test.setTimeout(collaborationTimeout * 4);

		await expectTodoReplicatedFromRelay({
			browser,
			sourceName: 'Alice',
			targetName: 'Bob',
			todoText: `alice-${runId}-relay-pinned-before-bob-open`
		});
	});

	test('Alice opens Bob database after the relay replicated Bob todo', async ({ browser }) => {
		test.setTimeout(collaborationTimeout * 4);

		await expectTodoReplicatedFromRelay({
			browser,
			sourceName: 'Bob',
			targetName: 'Alice',
			todoText: `bob-${runId}-relay-pinned-before-alice-open`
		});
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

/**
 * @param {import('@playwright/test').Page} page
 */
async function publishOrbitDBIdentity(page) {
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const hooks = window.__simpleTodoE2E;
					if (!hooks?.publishOrbitDBIdentity) return false;
					return hooks.publishOrbitDBIdentity();
				}),
			{ timeout: collaborationTimeout }
		)
		.toBe(true);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string | undefined | null} hash
 * @param {string} label
 */
async function waitForKnownOrbitDBIdentity(page, hash, label) {
	if (!hash) throw new Error(`${label}: missing OrbitDB identity hash.`);

	await expect
		.poll(
			() =>
				page.evaluate(async (identityHash) => {
					const hooks = window.__simpleTodoE2E;
					if (!hooks?.hasOrbitDBIdentity) return false;
					return hooks.hasOrbitDBIdentity(identityHash);
				}, hash),
			{ timeout: collaborationTimeout }
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
 * @param {import('@playwright/test').Page} [sourcePage]
 */
async function expectTodoWithReplicationPoll(page, text, sourcePage) {
	const deadline = Date.now() + collaborationTimeout;

	while (Date.now() < deadline) {
		if (sourcePage) {
			await announceTodoDatabaseEntries(sourcePage);
		}

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
 * @param {import('@playwright/test').Page} page
 * @param {{ attempts?: number, delayMs?: number }} [options]
 */
async function announceTodoDatabaseEntriesToRelay(page, { attempts = 1, delayMs = 0 } = {}) {
	const relayMultiaddr = getRelayMultiaddr();
	if (!relayMultiaddr) return;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		await expect
			.poll(
				() =>
					page.evaluate(async (address) => {
						if (typeof window.announceTodoDatabaseEntriesToMultiaddr !== 'function') {
							return { sent: false, entryCount: 0 };
						}
						return window.announceTodoDatabaseEntriesToMultiaddr(address);
					}, relayMultiaddr),
				{ timeout: collaborationTimeout }
			)
			.toMatchObject({ sent: true });

		if (attempt < attempts && delayMs > 0) {
			await page.waitForTimeout(delayMs);
		}
	}
}

/**
 * @param {import('@playwright/test').Page} sourcePage
 * @param {import('@playwright/test').Page} targetPage
 */
async function transferTodoDatabaseEntries(sourcePage, targetPage) {
	const payload = await sourcePage.evaluate(async () => {
		if (typeof window.exportTodoDatabaseEntries !== 'function') return null;
		return window.exportTodoDatabaseEntries();
	});

	if (!payload) {
		throw new Error('No Todo database entries were available to transfer.');
	}

	const targetAddress = await getActiveTodoDbAddress(targetPage);
	expect(payload.dbAddress).toBe(targetAddress);

	await targetPage.evaluate(async (entriesPayload) => {
		if (typeof window.importTodoDatabaseEntries !== 'function') {
			throw new Error('Todo database entry import hook is not available.');
		}
		await window.importTodoDatabaseEntries(entriesPayload);
	}, payload);
}

/**
 * @param {{
 *   browser: import('@playwright/test').Browser,
 *   sourceName: string,
 *   targetName: string,
 *   todoText: string
 * }} options
 */
async function expectTodoReplicatedFromRelay({ browser, sourceName, targetName, todoText }) {
	const sourceContext = await browser.newContext();
	const targetContext = await browser.newContext();
	const sourcePage = await sourceContext.newPage();
	const targetPage = await targetContext.newPage();
	let sourceClosed = false;

	try {
		await openReadyApp(sourcePage);
		await ensureRelayConnection(sourcePage, sourceName);

		const sourceDbAddress = await getTodoDbAddress(sourcePage);
		await publishOrbitDBIdentity(sourcePage);
		await addTodo(sourcePage, todoText);
		await announceTodoDatabaseEntries(sourcePage, { attempts: 3, delayMs: 3000 });
		await announceTodoDatabaseEntriesToRelay(sourcePage, { attempts: 3, delayMs: 1000 });
		const relayProof = await assertRelayReplicatedDatabase(
			sourceDbAddress,
			`${sourceName} todo database`,
			todoText,
			sourcePage
		);
		test.info().annotations.push({
			type: 'relay-pinning-proof',
			description: JSON.stringify({
				sourceName,
				targetName,
				dbAddress: sourceDbAddress,
				relayProof
			})
		});

		await sourceContext.close();
		sourceClosed = true;

		await openReadyApp(targetPage);
		await ensureRelayConnection(targetPage, targetName);
		await loadTodoDb(targetPage, sourceDbAddress);
		await expectTodoWithReplicationPoll(targetPage, todoText);
	} finally {
		await targetContext.close();
		if (!sourceClosed) {
			await sourceContext.close();
		}
	}
}

/**
 * @param {string} dbAddress
 * @param {string} label
 * @param {string} todoText
 * @param {import('@playwright/test').Page} [sourcePage]
 */
async function assertRelayReplicatedDatabase(dbAddress, label, todoText, sourcePage) {
	const relayHttpOrigin = getRelayHttpOrigin();
	const deadline = Date.now() + collaborationTimeout;
	let lastError = '';

	while (Date.now() < deadline) {
		try {
			if (sourcePage) {
				await announceTodoDatabaseEntries(sourcePage);
				await announceTodoDatabaseEntriesToRelay(sourcePage);
			}

			let sync = null;
			let syncError = '';

			try {
				sync = await syncRelayDatabase(relayHttpOrigin, dbAddress, sourcePage, 2000);
			} catch (error) {
				syncError = error instanceof Error ? error.message : String(error);
			}

			const databases = await relayFetchJson(
				`${relayHttpOrigin}/pinning/databases?address=${encodeURIComponent(dbAddress)}`
			);
			const databaseRecord = Array.isArray(databases?.databases)
				? databases.databases.find((entry) => entry?.address === dbAddress)
				: null;
			const relayEntryCount =
				typeof sync?.entryCount === 'number'
					? sync.entryCount
					: typeof databaseRecord?.entryCount === 'number'
						? databaseRecord.entryCount
						: 0;

			if (
				databaseRecord &&
				relayEntryCount > 0 &&
				relayProofContainsTodo({ sync, databaseRecord }, todoText)
			) {
				return {
					sync,
					syncError,
					databases
				};
			}

			lastError = JSON.stringify({ sync, syncError, databases });
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}

		await sleep(2000);
	}

	throw new Error(`Timed out waiting for relay to replicate ${label}: ${lastError}`);
}

/**
 * @param {{ sync: any, databaseRecord: any }} proof
 * @param {string} todoText
 */
function relayProofContainsTodo(proof, todoText) {
	return JSON.stringify(proof).includes(todoText);
}

/**
 * @param {string} relayHttpOrigin
 * @param {string} dbAddress
 * @param {import('@playwright/test').Page | undefined} sourcePage
 * @param {number} [timeoutMs]
 */
async function syncRelayDatabase(relayHttpOrigin, dbAddress, sourcePage, timeoutMs = 30000) {
	let announceInterval = /** @type {ReturnType<typeof setInterval> | null} */ (null);

	if (sourcePage) {
		announceInterval = setInterval(() => {
			void announceTodoDatabaseEntries(sourcePage).catch(() => {
				// The source page may close while a sync attempt is being cleaned up.
			});
			void announceTodoDatabaseEntriesToRelay(sourcePage).catch(() => {
				// The source page may close while a sync attempt is being cleaned up.
			});
		}, 1000);
	}

	try {
		return await relayFetchJson(
			`${relayHttpOrigin}/pinning/sync`,
			{
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ dbAddress })
			},
			timeoutMs
		);
	} finally {
		if (announceInterval) {
			clearInterval(announceInterval);
		}
	}
}

function getRelayHttpOrigin() {
	const fromEnv = process.env.E2E_RELAY_HTTP_ORIGIN?.trim();
	if (fromEnv) return fromEnv.replace(/\/+$/, '');

	const relayInfo = getRelayInfo();
	const fromRelayInfo =
		typeof relayInfo?.httpOrigin === 'string' ? relayInfo.httpOrigin.trim() : '';

	if (!fromRelayInfo) {
		throw new Error('Missing relay HTTP origin. Set E2E_RELAY_HTTP_ORIGIN for public relay runs.');
	}

	return fromRelayInfo.replace(/\/+$/, '');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} label
 */
async function ensureRelayConnection(page, label) {
	const relayMultiaddr = getRelayMultiaddr();
	const deadline = Date.now() + collaborationTimeout;
	let lastDialError = '';

	while (Date.now() < deadline) {
		const hasConnection = await page.evaluate(
			() => (window.__simpleTodoE2E?.getConnectionCount?.() ?? 0) >= 1
		);
		if (hasConnection) return;

		if (relayMultiaddr) {
			try {
				const dialResult = await page.evaluate(async (address) => {
					const hook = window.__simpleTodoE2E?.connectToMultiaddr;
					if (typeof hook === 'function') {
						return await hook(address);
					}
					return null;
				}, relayMultiaddr);
				if (dialResult?.status === 'stable') return;
			} catch (error) {
				lastDialError = error instanceof Error ? error.message : String(error);
			}

			await page.waitForTimeout(2000);
		} else {
			break;
		}
	}

	try {
		await waitForConnectionCount(page, 1);
	} catch (error) {
		if (!lastDialError) throw error;
		throw new Error(
			`Timed out waiting for ${label} relay connection. Last explicit relay dial error: ${lastDialError}`
		);
	}
}

function getRelayMultiaddr() {
	const fromEnv =
		process.env.E2E_PUBLIC_RELAY_BOOTSTRAP_ADDR?.trim() ||
		process.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD?.trim() ||
		process.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV?.trim() ||
		'';
	if (fromEnv) return fromEnv.split(',')[0].trim();

	const relayInfo = getRelayInfo();
	const fromRelayInfo = typeof relayInfo?.multiaddr === 'string' ? relayInfo.multiaddr.trim() : '';
	return fromRelayInfo.split(',')[0].trim();
}

function getRelayInfo() {
	return JSON.parse(readFileSync(relayInfoUrl, 'utf8'));
}

/**
 * @param {string} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs]
 */
async function relayFetchJson(url, options = {}, timeoutMs = 30000) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal
		});
		const body = await response.text();

		if (!response.ok) {
			throw new Error(`${options.method || 'GET'} ${url} returned ${response.status}: ${body}`);
		}

		return JSON.parse(body);
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * @param {number} ms
 */
function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
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
