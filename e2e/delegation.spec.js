import { test, expect } from '@playwright/test';

// Chapter (delegation01): a list stays owner-only, but the owner may hand ONE
// todo to another DID. That delegate may complete or rename exactly that todo
// — and nothing else — until the owner revokes it or the delegation expires.
// Every delegated write is confirmed with the delegate's passkey first.
//
// Three passkey identities, each in its own browser context:
//   Alice  owns the list
//   Bob    is the delegate
//   Mallory has the address, and no rights

const testUrl = '/';
const timeout = 90000;

/** Progress in the CI log, so a timeout says which step it was. @param {string} message */
function step(message) {
	console.log(`[delegation ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

test.describe('Per-todo delegation', () => {
	test('Bob completes and renames the todo Alice delegated to him, and nothing else', async ({
		browser
	}) => {
		test.setTimeout(timeout * 6);
		const alice = await newIdentity(browser, 'Alice');
		const bob = await newIdentity(browser, 'Bob');
		const mallory = await newIdentity(browser, 'Mallory');
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const delegated = `delegated-${runId}`;
		const kept = `kept-${runId}`;
		const renamed = `${delegated}-renamed-by-bob`;

		try {
			// 1. Alice: private list, Bob's DID on one todo, a second todo for herself.
			step('identities ready; Alice creates the list');
			await createPrivateList(alice.page);
			await addTodoOk(alice.page, delegated, { delegateDid: bob.did });
			await addTodoOk(alice.page, kept);
			const address = await getActiveDatabaseAddress(alice.page);
			const delegatedRow = rowFor(alice.page, delegated);
			await expect(delegatedRow.getByTestId('todo-delegate')).toHaveAttribute('data-did', bob.did);
			await expect(delegatedRow.getByTestId('todo-delegation-status')).toHaveText('active');

			// 2. Bob and Mallory open the list by address. Neither is in the write set.
			step('Bob and Mallory open the list by address');
			await openListByAddress(bob.page, address);
			await openListByAddress(mallory.page, address, 3);
			for (const page of [bob.page, mallory.page]) {
				await expectTodo(page, delegated);
				await expectTodo(page, kept);
				await addTodoExpectDenied(page, `intruder-${runId}`);
			}

			// 3. Only the delegated row is Bob's to change; nothing is Mallory's.
			step('roles on the rows');
			await expect(rowFor(bob.page, delegated)).toHaveAttribute('data-role', 'delegate');
			await expect(rowFor(bob.page, kept)).toHaveAttribute('data-role', 'none');
			await expect(checkbox(bob.page, kept)).toBeDisabled();
			await expect(rowFor(mallory.page, delegated)).toHaveAttribute('data-role', 'none');
			await expect(checkbox(mallory.page, delegated)).toBeDisabled();
			await expect(checkbox(mallory.page, kept)).toBeDisabled();

			// 4. Bob completes it. His passkey is asked first; the write lands on Alice's side.
			step('Bob completes the delegated todo');
			await checkbox(bob.page, delegated).check();
			await expectDelegatedWriteSigned(bob.page, 'set-completed');
			await expect(checkbox(bob.page, delegated)).toBeChecked({ timeout });
			await expect(checkbox(alice.page, delegated)).toBeChecked({ timeout });
			await expect(rowFor(alice.page, delegated).getByTestId('todo-updated-by')).toBeVisible({
				timeout
			});

			// 5. Bob renames it; Alice and Mallory see the new text.
			step('Bob renames it');
			await renameTodo(bob.page, delegated, renamed);
			await expectDelegatedWriteSigned(bob.page, 'patch-fields');
			await expectTodo(alice.page, renamed);
			await expectTodo(mallory.page, renamed);

			// 6. Alice's own todo was never touched.
			step('done; checking the untouched todo');
			await expect(checkbox(alice.page, kept)).not.toBeChecked();
		} finally {
			await Promise.all([alice.close(), bob.close(), mallory.close()]);
		}
	});

	test('Revoking takes the delegation back, including what Bob already did', async ({
		browser
	}) => {
		test.setTimeout(timeout * 5);
		const alice = await newIdentity(browser, 'Alice');
		const bob = await newIdentity(browser, 'Bob');
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const todo = `revocable-${runId}`;

		try {
			await createPrivateList(alice.page);
			await addTodoOk(alice.page, todo, { delegateDid: bob.did });
			const address = await getActiveDatabaseAddress(alice.page);
			await openListByAddress(bob.page, address);
			await expectTodo(bob.page, todo);

			// Bob completes it while delegated.
			await checkbox(bob.page, todo).check();
			await expectDelegatedWriteSigned(bob.page, 'set-completed');
			await expect(checkbox(alice.page, todo)).toBeChecked({ timeout });

			// Alice revokes. The completion is a delegate action; without the
			// delegation it no longer applies — on both sides.
			await rowFor(alice.page, todo).getByTestId('todo-revoke-delegation').click();
			await expect(rowFor(alice.page, todo).getByTestId('todo-delegation-status')).toHaveText(
				'revoked',
				{ timeout }
			);
			await expect(checkbox(alice.page, todo)).not.toBeChecked({ timeout });
			await expect(rowFor(bob.page, todo).getByTestId('todo-delegation-status')).toHaveText(
				'revoked',
				{ timeout }
			);
			await expect(checkbox(bob.page, todo)).not.toBeChecked({ timeout });
			await expect(checkbox(bob.page, todo)).toBeDisabled();
			await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'none');
		} finally {
			await Promise.all([alice.close(), bob.close()]);
		}
	});

	test('An expired delegation grants nothing; re-delegating from the row brings it back', async ({
		browser
	}) => {
		test.setTimeout(timeout * 5);
		const alice = await newIdentity(browser, 'Alice');
		const bob = await newIdentity(browser, 'Bob');
		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const todo = `expiring-${runId}`;

		try {
			await createPrivateList(alice.page);
			// Expired a minute ago: the UI shows it, and the checkbox stays disabled for Bob.
			const aMinuteAgo = new Date(Date.now() - 60_000);
			await addTodoOk(alice.page, todo, { delegateDid: bob.did, expiresAt: aMinuteAgo });
			await expect(rowFor(alice.page, todo).getByTestId('todo-delegation-status')).toHaveText(
				'expired'
			);
			const address = await getActiveDatabaseAddress(alice.page);
			await openListByAddress(bob.page, address);
			await expectTodo(bob.page, todo);
			await expect(rowFor(bob.page, todo).getByTestId('todo-delegation-status')).toHaveText(
				'expired'
			);
			await expect(checkbox(bob.page, todo)).toBeDisabled();

			// Alice re-delegates from the row, this time without an expiry.
			const row = rowFor(alice.page, todo);
			await row.getByTestId('todo-delegate-open').click();
			await row.getByTestId('todo-delegate-did-input').fill(bob.did);
			await row.getByTestId('todo-delegate-save').click();
			await expect(row.getByTestId('todo-delegation-status')).toHaveText('active', { timeout });

			await expect(checkbox(bob.page, todo)).toBeEnabled({ timeout });
			await checkbox(bob.page, todo).check();
			await expectDelegatedWriteSigned(bob.page, 'set-completed');
			await expect(checkbox(alice.page, todo)).toBeChecked({ timeout });
		} finally {
			await Promise.all([alice.close(), bob.close()]);
		}
	});
	// The three above put Alice and Bob in front of each other. These put the
	// relay between them — and all three are `fixme`, because what they assert
	// is wanted and does not happen yet, and because the *reason* is not
	// established.
	//
	// What is measured: with the writer's context closed outright and the
	// reader demonstrably reconnected, neither a delegation nor a revocation
	// reaches the reader.
	//
	// What is NOT established is why, and four instruments produced plausible
	// wrong answers on the way here, so the bar is high:
	//
	//   · a reload — this chapter keeps nothing across one (Helia is in memory),
	//     so it measured that gap instead of the relay
	//   · the peer count in the panel — counts something other than
	//     `getConnections()` and stayed at 1 long after the last had gone
	//   · `setOffline` — cuts the WebSocket to the relay within ten seconds and
	//     leaves an established `/webrtc/p2p/…` to the other browser standing
	//     indefinitely, which is the wrong way round for this question
	//   · `entryCount` from `/pinning/databases` — reported 0 for every list
	//     including one the relay had demonstrably received, because the relay
	//     falls back to `db.all()` there. `/pinning/has-entry` is the endpoint
	//     the app itself trusts
	//
	// The relay does receive entries: `default-database-collaboration.spec.js`
	// requires an exact relay-side replication proof and passes. So "the relay
	// has nothing" is ruled out, and the open question is narrower — whether a
	// private list ever asks for that proof the way the shared list does.
	// at no point after the write is made are both online,
	// so anything that arrives came out of the relay and not off the other
	// browser. That is the case the README makes a claim about, and a claim
	// nothing measured until now.
	test.fixme(
		'a delegation made while the delegate is offline arrives from the relay',
		async ({ browser }) => {
			test.setTimeout(timeout * 6);
			const alice = await newIdentity(browser, 'Alice', { webrtc: false });
			const bob = await newIdentity(browser, 'Bob', { webrtc: false });
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const todo = `offline-delegated-${runId}`;

			try {
				step('Alice creates the list; Bob opens it, then drops off the network');
				await createPrivateList(alice.page);
				await addTodoOk(alice.page, todo);
				const address = await getActiveDatabaseAddress(alice.page);
				await openListByAddress(bob.page, address);
				await expectTodo(bob.page, todo);
				await goOffline(bob.page);

				step('Alice delegates to a Bob who cannot hear it, then goes offline herself');
				await rowFor(alice.page, todo).getByTestId('todo-delegate-open').click();
				await rowFor(alice.page, todo).getByTestId('todo-delegate-did-input').fill(bob.did);
				await rowFor(alice.page, todo).getByTestId('todo-delegate-save').click();
				await expect(rowFor(alice.page, todo).getByTestId('todo-delegation-status')).toHaveText(
					'active',
					{ timeout }
				);
				// Nothing reached Bob directly — if it had, what arrives after Alice
				// is gone would prove nothing about the relay.
				await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'none');

				step('Alice leaves entirely; only the relay still holds it');
				await alice.close();

				step('Bob comes back with nobody but the relay to ask');
				await comeBackOnline(bob.page);

				// The delegation is the owner's own entry, so a relay that pins her
				// writes has it — this is the half the README says works.
				await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'delegate', { timeout });
			} finally {
				await Promise.allSettled([alice.close(), bob.close()]); // idempotent
			}
		}
	);

	test.fixme(
		'a revocation made while the delegate is offline arrives from the relay',
		async ({ browser }) => {
			test.setTimeout(timeout * 6);
			const alice = await newIdentity(browser, 'Alice', { webrtc: false });
			const bob = await newIdentity(browser, 'Bob', { webrtc: false });
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const todo = `offline-revoked-${runId}`;

			try {
				step('Alice delegates while both are present');
				await createPrivateList(alice.page);
				await addTodoOk(alice.page, todo, { delegateDid: bob.did });
				const address = await getActiveDatabaseAddress(alice.page);
				await openListByAddress(bob.page, address);
				await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'delegate', { timeout });

				step('Bob drops off; Alice revokes and goes offline too');
				await goOffline(bob.page);
				await rowFor(alice.page, todo).getByTestId('todo-revoke-delegation').click();
				await expect(rowFor(alice.page, todo).getByTestId('todo-delegation-status')).toHaveText(
					'revoked',
					{ timeout }
				);
				await expect(rowFor(bob.page, todo).getByTestId('todo-delegation-status')).toHaveText(
					'active'
				);

				step('Alice leaves entirely; only the relay still holds the revocation');
				await alice.close();

				step('Bob returns and must learn he no longer holds it');
				await comeBackOnline(bob.page);

				// A revocation that does not travel is the dangerous half: Bob would
				// go on believing the todo is his, and act on it.
				await expect(rowFor(bob.page, todo).getByTestId('todo-delegation-status')).toHaveText(
					'revoked',
					{ timeout }
				);
				await expect(checkbox(bob.page, todo)).toBeDisabled();
			} finally {
				await Promise.allSettled([alice.close(), bob.close()]); // idempotent
			}
		}
	);

	// This one cannot even be staged: with the direct connection surviving
	// `setOffline`, "the owner is offline" is not a state this harness can
	// produce once the two have met. The run that exposed it failed on the
	// *setup* assertion — Alice's todo was already ticked while she was
	// supposedly offline.
	test.fixme(
		"a delegate's completion made while the owner is offline arrives from the relay",
		async ({ browser }) => {
			test.setTimeout(timeout * 6);
			const alice = await newIdentity(browser, 'Alice', { webrtc: false });
			const bob = await newIdentity(browser, 'Bob', { webrtc: false });
			const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const todo = `offline-completed-${runId}`;

			try {
				step('Alice delegates to Bob while both are present, then goes offline');
				await createPrivateList(alice.page);
				await addTodoOk(alice.page, todo, { delegateDid: bob.did });
				const address = await getActiveDatabaseAddress(alice.page);
				await openListByAddress(bob.page, address);
				await expect(rowFor(bob.page, todo)).toHaveAttribute('data-role', 'delegate', { timeout });
				await goOffline(alice.page);

				step('Bob completes it with nobody but the relay listening');
				await checkbox(bob.page, todo).click();
				await expectDelegatedWriteSigned(bob.page, 'set-completed');
				await expect(checkbox(bob.page, todo)).toBeChecked({ timeout });
				await expect(checkbox(alice.page, todo)).not.toBeChecked();

				step('Bob leaves entirely; only the relay could still carry it');
				await bob.close();

				step('Alice returns and must find it done');
				await comeBackOnline(alice.page);

				// This is the half the README says does not work: the relay opens the
				// list with its built-in `orbitdb` controller, which knows nothing of
				// delegation, and refuses a delegate's entry. Asserted as the
				// behaviour we want rather than the behaviour we have — if it passes,
				// the README is wrong and should be corrected.
				await expect(checkbox(alice.page, todo)).toBeChecked({ timeout });
			} finally {
				await Promise.allSettled([alice.close(), bob.close()]); // idempotent
			}
		}
	);
});

// ---------------------------------------------------------------------------

/**
 * A browser context with its own virtual authenticator and a fresh passkey
 * identity, already past the consent screen.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {string} label
 */
async function newIdentity(browser, label, { webrtc = true } = {}) {
	const context = await browser.newContext();

	// Relay-only, for the tests that have to prove something arrived *through*
	// the relay. Measured: Playwright's `setOffline` cuts the WebSocket to the
	// relay after a few seconds but leaves an established `/webrtc/p2p/…`
	// connection to the other browser standing indefinitely — WebRTC does not
	// go through the stack it emulates. So "offline" without this switch
	// removes the relay and keeps the direct path, which is the wrong way round
	// for the question being asked.
	if (!webrtc) {
		await context.addInitScript(() => {
			try {
				localStorage.setItem('simpleTodo.webrtcEnabled', 'false');
			} catch {
				// Storage blocked; the test will fail on the peer count instead.
			}
		});
	}
	const page = await context.newPage();
	// Browser-side failures are otherwise invisible in a CI log; a refused
	// write or a failed passkey prompt shows up here, tagged with who saw it.
	page.on('console', (message) => {
		if (message.type() === 'error' || message.type() === 'warning') {
			console.log(`[${label}:${message.type()}] ${message.text()}`);
		}
	});
	page.on('pageerror', (error) => console.log(`[${label}:pageerror] ${error.message}`));
	await addVirtualAuthenticator(page);
	await openReadyAppWithNewPasskey(page, { label });
	const did = await getOwnDid(page);
	step(`${label} is ${did.slice(0, 20)}…`);
	return { page, did, close: () => context.close() };
}

/** @param {import('@playwright/test').Page} page */
async function addVirtualAuthenticator(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasLargeBlob: true,
			automaticPresenceSimulation: true
		}
	});
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ label: string }} identity
 */
async function openReadyAppWithNewPasskey(page, { label }) {
	await page.goto(testUrl);
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();
	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	await page.getByTestId('identity-mode-create').check();
	await page.getByTestId('passkey-label').fill(label);
	await page.getByRole('button', { name: 'Open shared list' }).click();
	await expect(modal).not.toBeVisible({ timeout });
	await expect(todoInput(page)).toBeEnabled({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function getOwnDid(page) {
	const badge = page.getByTestId('own-did-value');
	await expect(badge).toBeVisible({ timeout });
	const did = await badge.getAttribute('data-did');
	if (!did) throw new Error('own DID badge has no data-did');
	return did;
}

/** @param {import('@playwright/test').Page} page */
async function createPrivateList(page) {
	await page.getByTestId('new-list-create').click();
	await expect(page.getByTestId('permissions-panel')).toBeVisible({ timeout });
	// The list's controller accepts delegation, so the form offers it.
	await expect(page.getByTestId('add-todo-delegate-toggle')).toBeVisible({ timeout });
}

/** @param {import('@playwright/test').Page} page */
async function getActiveDatabaseAddress(page) {
	const el = page.getByTestId('active-database-address');
	await expect
		.poll(async () => ((await el.textContent()) ?? '').trim(), { timeout })
		.toMatch(/^\/orbitdb\//);
	return ((await el.textContent()) ?? '').trim();
}

/**
 * Wait until this browser is connected to at least `count` peers (the relay
 * counts as one). Three browsers starting within seconds of each other race
 * for relay reservations, and a dial that lands before the other side has
 * one fails with NO_RESERVATION; the app retries discovered peers on a
 * timer, so the count does climb — but opening a list by address before it
 * has means fetching the manifest block from nobody.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} count
 */
async function waitForPeers(page, count) {
	const details = page.getByTestId('network-details');
	await expect
		.poll(
			async () => {
				const text = (await details.textContent()) ?? '';
				const match = /(\d+) peers?/.exec(text);
				return match ? Number(match[1]) : 0;
			},
			{ timeout, message: `waiting for ${count} peers` }
		)
		.toBeGreaterThanOrEqual(count);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} address
 * @param {number} [peers] how many peers (relay included) this browser should have first
 */
async function openListByAddress(page, address, peers = 2) {
	await waitForPeers(page, peers);
	await page.getByTestId('open-db-address-input').fill(address);
	const el = page.getByTestId('active-database-address');
	// Opening by address fetches the manifest block from whoever has it. With
	// three fresh browsers still finding each other, that fetch can time out
	// once ("Failed to load block for …") before the peers are connected —
	// the same retry a person would make. Not a delegation concern.
	for (let attempt = 1; attempt <= 3; attempt++) {
		await page.getByTestId('open-db-button').click();
		const opened = await expect
			.poll(async () => ((await el.textContent()) ?? '').trim(), { timeout })
			.toBe(address)
			.then(
				() => true,
				() => false
			);
		if (opened) return;
		step(`open by address failed (attempt ${attempt}), retrying`);
	}
	throw new Error(`Could not open ${address} after 3 attempts`);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @param {{ delegateDid?: string, expiresAt?: Date }} [delegation]
 */
async function addTodoOk(page, text, delegation = {}) {
	await todoInput(page).fill(text);
	if (delegation.delegateDid) {
		const toggle = page.getByTestId('add-todo-delegate-toggle');
		if (!(await toggle.isChecked())) await toggle.check();
		await page.getByTestId('add-todo-delegate-did').fill(delegation.delegateDid);
		if (delegation.expiresAt) {
			await page
				.getByTestId('add-todo-delegation-expiry')
				.fill(toDatetimeLocal(delegation.expiresAt));
		}
	}
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expectTodo(page, text);
}

/**
 * A denied write must raise a visible error and NOT render the todo.
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodoExpectDenied(page, text) {
	await todoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(/no write permission|write access/i)).toBeVisible({ timeout });
	await page.waitForTimeout(2000);
	await expect(page.getByText(text, { exact: true })).toHaveCount(0);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} from
 * @param {string} to
 */
async function renameTodo(page, from, to) {
	const row = rowFor(page, from);
	await row.getByTestId('todo-edit').click();
	await row.getByTestId('todo-edit-input').fill(to);
	await row.getByTestId('todo-edit-save').click();
	await expectTodo(page, to);
}

/**
 * The passkey prompt before a delegated write: the badge goes through
 * `awaiting` and ends on `success`. The virtual authenticator answers at
 * once, so `awaiting` may already be over; `success` is the assertion.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'set-completed' | 'patch-fields'} action
 */
async function expectDelegatedWriteSigned(page, action) {
	const badge = page.getByTestId('delegated-auth-state');
	await expect(badge).toHaveAttribute('data-state', 'success', { timeout });
	await expect(badge).toHaveAttribute('data-action', action);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function expectTodo(page, text) {
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
}

/** @param {import('@playwright/test').Page} page @param {string} text */
function rowFor(page, text) {
	// Matched on the row itself, not on the text span: the span is replaced
	// by an input while the todo is being renamed, and a locator through it
	// would wait forever for the row to come back.
	return page.locator(`[data-testid="todo-item"][data-todo-text="${text}"]`);
}

/** @param {import('@playwright/test').Page} page @param {string} text */
function checkbox(page, text) {
	return rowFor(page, text).getByTestId('todo-complete-checkbox');
}

/** @param {import('@playwright/test').Page} page */
function todoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}

/** `datetime-local` wants local wall-clock time without a zone. @param {Date} date */
function toDatetimeLocal(date) {
	const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * Take this browser off the network and give libp2p time to notice.
 *
 * Deliberately not asserting that every connection has gone. Measured:
 * `setOffline` drops the WebSocket to the relay after a few seconds and leaves
 * an established `/webrtc/p2p/…` to the other browser standing indefinitely —
 * WebRTC does not travel through the stack Playwright emulates. Waiting for
 * zero therefore never returns.
 *
 * The tests below do not need it to. They prove the direct path delivered
 * nothing by *checking* that it delivered nothing, and then close the other
 * browser outright before asking again — a context that no longer exists
 * cannot be the source of what arrives next.
 *
 * @param {import('@playwright/test').Page} page
 */
async function goOffline(page) {
	await page.context().setOffline(true);
	await page.waitForTimeout(12000);
}

/**
 * Back on the network, and connected to something again.
 *
 * Without this the two tests above cannot be read: a delegate who never
 * reconnected would receive nothing whether the relay had it or not, and the
 * absence would look like a refusal.
 *
 * @param {import('@playwright/test').Page} page
 */
async function comeBackOnline(page) {
	await page.context().setOffline(false);
	await expect
		.poll(
			() => page.evaluate(() => (window.__simpleTodoDiagnostics?.getConnections?.() ?? []).length),
			{ timeout, message: 'waiting to be connected again' }
		)
		.toBeGreaterThan(0);
}
