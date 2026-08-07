import { test, expect } from '@playwright/test';

/**
 * Three browsers, two ways of meeting, one shared database (#129).
 *
 *   Alice ──relay── Bob ──invite── Carol
 *
 * Alice and Bob meet through the public relay. Carol switches the relay network
 * off on the consent screen and reaches Bob with an invite alone. Alice and
 * Carol never exchange anything and never meet.
 *
 * This is the first case where the two introduction mechanisms have to
 * cooperate rather than merely coexist: Bob has to carry entries across a
 * circuit-relay connection on one side - which libp2p marks *limited*, hence
 * `runOnLimitedConnection: true` - and a plain direct WebRTC connection on the
 * other.
 *
 * The last assertion is what keeps the rest honest. If Carol turned out to hold
 * a connection to Alice, a todo arriving at Carol would prove nothing about
 * relaying through Bob; it would just be ordinary replication over a link
 * nobody intended.
 */

const timeout = 90000;

test.describe('relay and invite meeting at one peer (#129)', () => {
	// Reproduces the failure rather than asserting the fix: the handshake does
	// not complete today, so the replication questions behind it stay unanswered.
	//
	// Measured, with Bob (relay mode) hosting the invite — he accepts Carol's
	// answer and the dial dies immediately:
	//
	//   That payload was rejected: No transport available for address
	//   /p2p/12D3KooWPYocBrkk5JoWjG8MS6YkkypmKQuwAnMkokoppko5kttC
	//
	// That is a libp2p-core error: no transport in Bob's list accepted the bare
	// `/p2p/<peerId>` the QR session dials. The same handshake between two
	// invite-only peers works (`qr-invite-merge.spec.js`), so the difference is
	// the node that also carries the relay transports.
	//
	// With the roles swapped — Carol hosting — the run does not fail there but
	// never completes either; it exhausted a 9-minute budget with the relay-mode
	// peers looping on `no valid addresses for peer` from pubsub discovery. Which
	// of the two is the real obstacle is not established.
	//
	// Unfixing this test is the acceptance criterion for #129.
	test.fixme(
		'a todo reaches Carol through Bob, and Carol never meets Alice',
		async ({ browser }) => {
			test.setTimeout(timeout * 6);

			const contexts = await Promise.all([
				browser.newContext(),
				browser.newContext(),
				browser.newContext()
			]);
			const [alice, bob, carol] = await Promise.all(contexts.map((context) => context.newPage()));

			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const backlog = `alice-backlog-${runId}`;
			const live = `alice-live-${runId}`;
			const fromCarol = `carol-${runId}`;

			try {
				// Alice and Bob take the ordinary route: relay network on.
				await Promise.all([openRelayApp(alice), openRelayApp(bob)]);
				await expect.poll(() => connectionCount(alice), { timeout }).toBeGreaterThan(0);
				await expect.poll(() => connectionCount(bob), { timeout }).toBeGreaterThan(0);

				// Baseline: the relay path itself works, so a later failure cannot be
				// blamed on it.
				await addTodo(alice, backlog);
				await expectTodo(bob, backlog);

				// Carol arrives blind — no relay, no discovery, no listen addresses.
				await openInviteOnlyApp(carol);
				await expect(connectionCount(carol)).resolves.toBe(0);
				await expectMissing(carol, backlog);

				await exchangeInvite(bob, carol);

				// 1a. Backlog: written before Carol existed, so it needs the OrbitDB
				// heads exchange plus the entry blocks over bitswap.
				await expectTodo(carol, backlog);

				// 1b. Live: gossipsub has to forward from Bob's relay-side mesh into his
				// invite-side mesh.
				await addTodo(alice, live);
				await expectTodo(carol, live);

				// 1c. The same path in reverse.
				await addTodo(carol, fromCarol);
				await expectTodo(alice, fromCarol);

				// 2. Carol must still be reachable only through Bob. Anything else and
				// the three assertions above were measuring something other than a
				// bridge.
				const bobPeerId = await peerId(bob);

				expect(await connectedPeerIds(carol)).toEqual([bobPeerId]);
			} finally {
				await Promise.all(contexts.map((context) => context.close()));
			}
		}
	);
});

/**
 * Consent with the relay network left on — the default, and what Alice and Bob
 * use. `consent-remember` is deliberately not ticked: persisting the decision
 * would skip the modal on any later load in the same context.
 *
 * @param {import('@playwright/test').Page} page
 */
async function acceptConsent(page, { relayNetwork = true } = {}) {
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();

	for (const checkbox of await modal.locator('input[type="checkbox"]:not([data-testid])').all()) {
		await checkbox.check();
	}

	if (!relayNetwork) {
		await page.getByTestId('consent-relay-network').uncheck();
	}

	await page.getByRole('button', { name: 'Proceed to Test the App' }).click();
	await expect(modal).not.toBeVisible();
	await expect(getTodoInput(page)).toBeEnabled({ timeout });
}

/**
 * The invite launcher lives inside the collapsed "Network details" panel now,
 * next to the manual connect form. It has to be expanded before either launcher
 * is visible — the same step a person takes.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openNetworkDetails(page) {
	const networkDetails = page.getByTestId('network-details');

	if ((await networkDetails.getAttribute('open')) === null) {
		await networkDetails.getByText('Network details', { exact: true }).click();
	}

	await expect(networkDetails).toHaveAttribute('open', '');
}

/** @param {import('@playwright/test').Page} page */
async function openRelayApp(page) {
	await page.goto('/');
	await acceptConsent(page);
}

/** @param {import('@playwright/test').Page} page */
async function openInviteOnlyApp(page) {
	await page.goto('/');
	await acceptConsent(page, { relayNetwork: false });
	await openNetworkDetails(page);
	await openInvitePanel(page);
}

/**
 * Bob is in relay mode, so his panel starts closed and he has to open it — the
 * same two clicks a person would make.
 *
 * @param {import('@playwright/test').Page} host
 * @param {import('@playwright/test').Page} guest
 */
async function exchangeInvite(host, guest) {
	// The host may still be in relay mode with the panel untouched, so its
	// launcher is behind the collapsed network panel too.
	await openNetworkDetails(host);
	await openInvitePanel(host);

	await host.getByTestId('qr-create-invite').click();
	await expect
		.poll(() => host.getByTestId('qr-outgoing').inputValue(), { timeout })
		.not.toHaveLength(0);

	const invite = await host.getByTestId('qr-outgoing').inputValue();

	await guest.getByTestId('qr-incoming').fill(invite);
	await guest.getByTestId('qr-use-payload').click();
	await expect
		.poll(() => guest.getByTestId('qr-outgoing').inputValue(), { timeout })
		.not.toHaveLength(0);

	const reply = await guest.getByTestId('qr-outgoing').inputValue();

	await host.getByTestId('qr-incoming').fill(reply);
	await host.getByTestId('qr-use-payload').click();
	await expect(host.getByTestId('qr-status')).toContainText('Connected', { timeout });
}

/**
 * Idempotent: the panel is already open for an invite-only peer, and clicking
 * the toggle would close it.
 *
 * @param {import('@playwright/test').Page} page
 */
async function openInvitePanel(page) {
	if ((await page.getByTestId('qr-connect').count()) === 0) {
		await page.getByTestId('qr-toggle').click();
	}

	await expect(page.getByTestId('qr-connect')).toBeVisible();
}

/** @param {import('@playwright/test').Page} page */
function connectionCount(page) {
	return page.evaluate(() => window.__simpleTodoE2E?.getConnectionCount?.() ?? 0);
}

/** @param {import('@playwright/test').Page} page */
function connectedPeerIds(page) {
	return page.evaluate(() => window.__simpleTodoE2E?.getConnectedPeerIds?.() ?? []);
}

/** @param {import('@playwright/test').Page} page */
function peerId(page) {
	return page.evaluate(() => window.__simpleTodoE2E?.getPeerId?.() ?? null);
}

/** @param {import('@playwright/test').Page} page */
function getTodoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	const input = getTodoInput(page);
	await input.fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(input).toHaveValue('');
	await expectTodo(page, text);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectTodo(page, text) {
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectMissing(page, text) {
	await expect(page.getByText(text, { exact: true })).toHaveCount(0);
}
