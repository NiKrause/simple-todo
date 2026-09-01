import { test, expect } from '@playwright/test';

/**
 * Two lists that could not see each other, joined by a scanned code.
 *
 * Both peers get here the way a user does: they untick "Connect to the public
 * libp2p relay network" on the consent screen and then press "Scan Connect SDP".
 * That leaves one transport - no relay, no bootstrap, no pubsub discovery,
 * nothing that can find a peer by itself. Which is what makes the result mean
 * something: if these two end up sharing a list, the invite is the only thing
 * that could have introduced them, and the test proves the isolation before it
 * proves the merge.
 *
 * `?transport=qr` reaches the same node and still works, but it is a developer
 * shortcut - testing through it would leave the route real users take unproven.
 *
 * What is *not* happening: two databases becoming one. Every peer on `main`
 * opens `simple-todos` with `write: ['*']`, and that manifest is content
 * addressed, so both peers computed the same OrbitDB address before they ever
 * met. Alice and Bob are writing to one log that has not replicated yet.
 * Connecting is what lets it - which is a stronger claim than a merge, because
 * nothing has to reconcile.
 */

const timeout = 90000;

test.describe('Invite-only collaboration', () => {
	test('two isolated todo lists become one after an invite is exchanged', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const aliceTodos = [`alice-${runId}-1`, `alice-${runId}-2`];
		const bobTodos = [`bob-${runId}-1`, `bob-${runId}-2`];

		try {
			await Promise.all([openInviteOnlyApp(alice), openInviteOnlyApp(bob)]);

			// Each writes its own list while the other is unreachable.
			for (const todo of aliceTodos) {
				await addTodo(alice, todo);
			}
			for (const todo of bobTodos) {
				await addTodo(bob, todo);
			}

			// The claim under test starts here: without the invite, neither list
			// contains the other's entries. A test that skipped this would pass just
			// as well if the two peers had met some other way.
			await expectMissing(alice, bobTodos[0]);
			await expectMissing(bob, aliceTodos[0]);
			expect(await connectedPeerCount(alice)).toBe(0);
			expect(await connectedPeerCount(bob)).toBe(0);

			await exchangeInvite(alice, bob);

			// One list on both screens, holding everything either of them wrote.
			for (const todo of [...aliceTodos, ...bobTodos]) {
				await expectTodo(alice, todo);
				await expectTodo(bob, todo);
			}

			// ...and it stays live: something written after the merge shows up too.
			const afterwards = `together-${runId}`;
			await addTodo(bob, afterwards);
			await expectTodo(alice, afterwards);
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});

	// The same handshake without a camera: Alice sends a link, Bob opens it. The
	// payload rides in the fragment, so nothing about the offer reaches a server
	// or an IPFS gateway on the way.
	test('an invite link connects a browser that never saw the code', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		const aliceContext = await browser.newContext();
		// Bob is a genuinely fresh browser whose first act is opening the link —
		// which is what "sent someone an invite" actually looks like.
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const aliceTodo = `alice-link-${runId}`;

		try {
			await openInviteOnlyApp(alice);
			await addTodo(alice, aliceTodo);

			await alice.getByTestId('qr-create-invite').click();
			await expect
				.poll(() => alice.getByTestId('qr-outgoing').inputValue(), { timeout })
				.not.toHaveLength(0);

			const invite = await alice.getByTestId('qr-outgoing').inputValue();
			const link = `/#invite=${encodeURIComponent(invite)}`;

			// Recorded rather than asserted against a threshold: whether a payload
			// still fits a link is a property of the codec, and a number in the log
			// is what makes a future regression legible.
			console.log(`[qr-link] invite payload ${invite.length} chars, link ${link.length} chars`);

			// No pasting, no scanning — and the consent screen comes first, so the
			// invite has to survive a wait for a node that does not exist yet.
			await bob.goto(link);
			await acceptConsent(bob, { relayNetwork: false });
			await expect(bob.getByTestId('qr-connect')).toBeVisible({ timeout });
			await expect
				.poll(() => bob.getByTestId('qr-outgoing').inputValue(), { timeout })
				.not.toHaveLength(0);

			// The spent offer must not survive in the address bar, or a reload would
			// replay it.
			expect(await bob.evaluate(() => window.location.hash)).toBe('');

			const reply = await bob.getByTestId('qr-outgoing').inputValue();

			await alice.getByTestId('qr-incoming').fill(reply);
			await alice.getByTestId('qr-use-payload').click();
			await expect(alice.getByTestId('qr-status')).toContainText('Connected', { timeout });

			// Bob never saw this todo by any other route.
			await expectTodo(bob, aliceTodo);
		} finally {
			await aliceContext.close();
			await bobContext.close();
		}
	});
});

/**
 * Walk the consent screen the way a person does, and switch the relay network
 * off there rather than through `?transport=qr`. That URL is a developer
 * shortcut; the checkbox is the route real users take, and it is what has to
 * actually produce an isolated node.
 *
 * @param {import('@playwright/test').Page} page
 */
async function acceptConsent(page, { relayNetwork = true } = {}) {
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();

	// `consent-remember` stays untouched on purpose: ticking it would persist the
	// decision, so the modal would not reappear when a page reloads through an
	// invite link - skipping the very state under test.
	// One gate now, where three acknowledgements used to be. It has a testid, so
	// the old selector - every checkbox *without* one - matched nothing and left
	// the button disabled.
	await modal.getByTestId('consent-accept').check();

	const relayBox = page.getByTestId('consent-relay-network');
	await expect(relayBox).toBeChecked();

	if (!relayNetwork) {
		await relayBox.uncheck();
	}

	// Unticking it must never block the button — it is a choice, not consent.
	const proceed = page.getByRole('button', { name: 'Proceed to Test the App' });
	await expect(proceed).toBeEnabled();
	await proceed.click();
	await expect(modal).not.toBeVisible();
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
async function openInviteOnlyApp(page) {
	await page.goto('/');
	await acceptConsent(page, { relayNetwork: false });
	await openNetworkDetails(page);

	// The panel is closed here, and that is not an oversight: the component reads
	// the preference when it mounts, which happens while the consent screen is
	// still up and the stored value is still the default. Opening it is what the
	// "Scan Connect SDP" button is for.
	await expect(page.getByTestId('qr-connect')).toHaveCount(0);
	await page.getByTestId('qr-toggle').click();
	await expect(page.getByTestId('qr-connect')).toBeVisible();
	await expect(getTodoInput(page)).toBeEnabled({ timeout });
}

/**
 * The exchange a person would do by holding up a code and reading one back.
 *
 * @param {import('@playwright/test').Page} alice
 * @param {import('@playwright/test').Page} bob
 */
async function exchangeInvite(alice, bob) {
	await alice.getByTestId('qr-create-invite').click();

	// The invite is shown as a code by <qr-invite>, themed from outside in this
	// app's own palette - which is the acceptance criterion #38 asks for and the
	// only way to know the custom properties actually cross the shadow boundary.
	await expect(alice.getByTestId('qr-code')).toBeVisible({ timeout });
	await expect(alice.locator('qr-code img, [data-testid="qr-code"] img').first()).toBeVisible({
		timeout
	});
	await expect
		.poll(() => alice.getByTestId('qr-outgoing').inputValue(), { timeout })
		.not.toHaveLength(0);

	const invite = await alice.getByTestId('qr-outgoing').inputValue();

	await bob.getByTestId('qr-incoming').fill(invite);
	await bob.getByTestId('qr-use-payload').click();
	await expect
		.poll(() => bob.getByTestId('qr-outgoing').inputValue(), { timeout })
		.not.toHaveLength(0);

	const reply = await bob.getByTestId('qr-outgoing').inputValue();

	await alice.getByTestId('qr-incoming').fill(reply);
	await alice.getByTestId('qr-use-payload').click();
	await expect(alice.getByTestId('qr-status')).toContainText('Connected', { timeout });

	await expect.poll(() => connectedPeerCount(alice), { timeout }).toBeGreaterThan(0);
	await expect.poll(() => connectedPeerCount(bob), { timeout }).toBeGreaterThan(0);
}

/** @param {import('@playwright/test').Page} page */
function connectedPeerCount(page) {
	return page.evaluate(() => {
		const node = /** @type {any} */ (window).__libp2p ?? null;

		return node?.getConnections().length ?? 0;
	});
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
	await getTodoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
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
	// Long enough that replication would have happened if it were going to.
	await page.waitForTimeout(4000);
	await expect(page.getByText(text, { exact: true })).toHaveCount(0);
}
