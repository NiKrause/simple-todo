import { test, expect } from '@playwright/test';

import { passConsent } from './consent.mjs';

/**
 * What replicates when the relay is the whole of the path.
 *
 * Every collaboration spec here waits for the connection to become `/webrtc`
 * before it checks anything — it measures the case where the hole punch
 * succeeds, which is the ordinary one and the one that works. Nothing measures
 * the other: two devices behind carrier NAT, where DCUtR gets nowhere and the
 * circuit is all there is.
 *
 * That gap was found in `Le-Space/ablage`, where the same shape turned out to
 * hide a real failure. The pieces are not the same here, and that is exactly
 * why it is worth measuring rather than assuming:
 *
 * - OrbitDB's **heads sync** dials `headsSyncAddress` and sets
 *   `runOnLimitedConnection` nowhere, so a circuit should refuse it
 * - OrbitDB's **live updates** go over gossipsub, and this app does set
 *   `runOnLimitedConnection: true` there, so they should cross
 * - **blocks fetched by CID** — older entries, identity resolution — go through
 *   bitswap, which refuses a limited connection by default
 *
 * So the expectation is a split: new todos arrive, an existing list does not.
 * The point of the spec is to find out, so it reports rather than asserts the
 * parts nobody has measured.
 *
 * WebRTC is switched off through the app's own setting rather than by breaking
 * the network, so this is a configuration the app already supports.
 */

const testUrl = '/';
const timeout = 90000;

test.describe('replication when only the relay carries it', () => {
	test('MEASUREMENT: what crosses a circuit between two browsers', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();

		try {
			const alice = await aliceContext.newPage();
			const bob = await bobContext.newPage();

			await Promise.all([openWithoutWebRTC(alice), openWithoutWebRTC(bob)]);

			const [alicePeer, bobPeer] = await Promise.all([getPeerId(alice), getPeerId(bob)]);

			// Waited for rather than read straight away: the first attempt looked
			// immediately, got two empty lists, and would have reported whatever
			// happened next as having crossed a circuit.
			await expect
				.poll(() => connectionTo(alice, bobPeer), { timeout })
				.not.toEqual([]);

			const carried = await Promise.all([connectionTo(alice, bobPeer), connectionTo(bob, alicePeer)]);
			console.log('CONNECTIONS alice→bob:', JSON.stringify(carried[0]));
			console.log('CONNECTIONS bob→alice:', JSON.stringify(carried[1]));

			// Nothing here is direct, or the spec is measuring the wrong thing.
			expect(
				carried.flat().some((c) => c.webrtc || c.limited === false),
				'an unlimited connection exists, so this is not the relay-only case'
			).toBe(false);

			const todo = `only-over-the-circuit-${Date.now()}`;
			await addTodo(alice, todo);

			const arrived = await bob
				.getByText(todo, { exact: true })
				.waitFor({ state: 'visible', timeout })
				.then(() => true, () => false);

			// **Whether the relay was a participant, not merely a route.**
			//
			// `orbitdb-relay` runs OrbitDB and pins what it sees, and it offers no
			// switch to stop. So rather than removing it, this asks what it did:
			// a todo the relay pinned may have reached Bob *from the relay*, over
			// his own unlimited WebSocket to it, without ever crossing a circuit.
			// Without this the measurement above cannot tell the two apart.
			const pinned = await alice
				.getByTestId('todo-item')
				.filter({ has: alice.getByText(todo, { exact: true }) })
				.getByTestId('todo-relay-status')
				.getAttribute('data-status')
				.catch(() => null);

			console.log(`LIVE UPDATE over a circuit: ${arrived ? 'arrived' : 'did not arrive'}`);
			console.log(`RELAY participation: ${pinned}`);

			expect(arrived, 'a todo created with no direct path did not reach the other browser').toBe(
				true
			);

			// Not yet pinned when it arrived, so it came over the circuit rather
			// than from the relay. The relay pinning it a moment later is expected
			// and fine - what would spoil the measurement is it having pinned
			// first, because then Bob could have had it from his own unlimited
			// WebSocket to the relay instead.
			expect(pinned, 'the relay had already pinned it, so the path is ambiguous').not.toBe(
				'pinned'
			);
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});

/** @param {import('@playwright/test').Page} page */
async function openWithoutWebRTC(page) {
	// Set before the app loads: `initializeWebRTCSetting` reads this key on
	// startup, and the transport list is built from it once.
	await page.addInitScript(() => {
		localStorage.setItem('simpleTodo.webrtcEnabled', 'false');
	});

	await page.goto(testUrl);

	// The relay is the whole point here, so it is asked for explicitly rather
	// than left to whatever the default happens to be.
	await passConsent(page, { relay: true });

	await expect(getTodoInput(page)).toBeEnabled({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function getPeerId(page) {
	await expect
		.poll(() => page.evaluate(() => window.__simpleTodoE2E?.getPeerId?.() ?? null), { timeout })
		.toBeTruthy();

	return page.evaluate(() => window.__simpleTodoE2E.getPeerId());
}

/** Every connection this page holds to one particular peer. */
async function connectionTo(page, peerId) {
	return page.evaluate(
		(id) =>
			(window.__simpleTodoE2E?.getConnections?.() ?? [])
				.filter((connection) => connection.remotePeer === id)
				.map((connection) => ({
					address: String(connection.remoteAddr ?? ''),
					// `limits` is what separates a relayed connection from a direct
					// one. The address does not: a hole-punched connection still
					// reads `/p2p-circuit/webrtc/…`.
					limited: connection.limited === true,
					encryption: connection.encryption ?? 'none',
					multiplexer: connection.multiplexer ?? 'none',
					webrtc: String(connection.remoteAddr ?? '').includes('/webrtc')
				})),
		peerId
	);
}

const getTodoInput = (page) => page.getByRole('textbox', { name: 'What needs to be done?' });

/** @param {import('@playwright/test').Page} page */
async function addTodo(page, text) {
	await getTodoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}
