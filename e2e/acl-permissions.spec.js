import { test, expect } from '@playwright/test';
import { passConsent } from './consent.mjs';

// Chapter (acl01): a list is owner-only until the owner grants another DID
// write access. Both directions are exercised — Alice-owner and Bob-owner —
// each with its own passkey identity in a separate browser context.

const testUrl = '/';
const timeout = 90000;

test.describe('DID-based write permissions', () => {
	test('Scenario 1 — Alice grants Bob access to alice-todos', async ({ browser }) => {
		await runGrantScenario(browser, { ownerName: 'Alice', guestName: 'Bob' });
	});

	test('Scenario 2 — Bob grants Alice access to bob-todos', async ({ browser }) => {
		await runGrantScenario(browser, { ownerName: 'Bob', guestName: 'Alice' });
	});
});

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {{ ownerName: string, guestName: string }} roles
 */
async function runGrantScenario(browser, { ownerName, guestName }) {
	test.setTimeout(timeout * 5);

	const ownerContext = await browser.newContext();
	const guestContext = await browser.newContext();
	const owner = await ownerContext.newPage();
	const guest = await guestContext.newPage();

	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const ownerTodo = `${ownerName.toLowerCase()}-${runId}-owner-todo`;
	const guestTodo = `${guestName.toLowerCase()}-${runId}-guest-todo`;

	try {
		await Promise.all([addVirtualAuthenticator(owner), addVirtualAuthenticator(guest)]);

		// 1. Owner registers a passkey, creates a PRIVATE (owner-only) list and
		//    writes the first todo. The mnemonic default list stays public.
		await openReadyAppWithNewPasskey(owner, { label: ownerName });
		await createPrivateList(owner);
		await addTodoOk(owner, ownerTodo);
		const dbAddress = await getActiveDatabaseAddress(owner);
		const guestDid = await (async () => {
			// 2. Guest opens the same list by address (read/replication works).
			await openReadyAppWithNewPasskey(guest, { label: guestName });
			await openListByAddress(guest, dbAddress);
			return getOwnDid(guest);
		})();

		// 3. The guest does NOT see the owner's todo, and this is where this
		//    chapter departs from `acl01`. There it read "guest sees the owner's
		//    todo", because OrbitDB has no read permission: the address is the
		//    permission. `privacy01` seals a private list (#277), so holding the
		//    address now buys replication and nothing else — the entries are
		//    there and unreadable.
		await expectNoTodo(guest, ownerTodo);

		// 4. Guest write MUST fail; UI shows an error; the list stays unchanged.
		await addTodoExpectDenied(guest, guestTodo);
		await expectNoTodo(guest, guestTodo);
		await expectNoTodo(owner, guestTodo);

		// 5. Owner grants the guest's DID write access — which in this chapter
		//    also seals a copy of the list's key for that DID, because write
		//    access to a list nobody can read is not access to anything.
		await grantWriteAccess(owner, guestDid);

		// 6. The guest opens the list again. The copy is waiting for it now, and
		//    the open picks it up; the instance already on screen was opened
		//    before the key existed and has no decryptor attached to it.
		await openListByAddress(guest, dbAddress);

		// 7. Now the guest reads what was sealed before it was admitted — the
		//    envelope, end to end — and can write.
		await expectTodo(guest, ownerTodo);
		await addTodoOk(guest, guestTodo);
		for (const page of [owner, guest]) {
			await expectTodo(page, ownerTodo);
			await expectTodo(page, guestTodo);
		}
	} finally {
		await guestContext.close();
		await ownerContext.close();
	}
}

/** @param {import('@playwright/test').Page} page */
async function createPrivateList(page) {
	await page.getByTestId('new-list-create').click();
	// The permissions panel only renders for access-controlled lists.
	await expect(page.getByTestId('permissions-panel')).toBeVisible({ timeout });
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
	await passConsent(page, { identity: 'create', label });
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
async function getActiveDatabaseAddress(page) {
	// The address lives in a collapsible nav panel (hidden by default), so read
	// its text content directly rather than requiring visibility.
	const el = page.getByTestId('active-database-address');
	await expect
		.poll(async () => ((await el.textContent()) ?? '').trim(), { timeout })
		.toMatch(/^\/orbitdb\//);
	return ((await el.textContent()) ?? '').trim();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} address
 */
async function openListByAddress(page, address) {
	await page.getByTestId('open-db-address-input').fill(address);
	await page.getByTestId('open-db-button').click();
	const el = page.getByTestId('active-database-address');
	await expect.poll(async () => ((await el.textContent()) ?? '').trim(), { timeout }).toBe(address);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} did
 */
async function grantWriteAccess(page, did) {
	// Granted once, then again while the app says the key did not go with it.
	//
	// This is not a retry papering over flakiness. In this chapter a grant also
	// seals a copy of the list key for the DID being admitted, and to do that it
	// has to *find* that DID's published key — which lives in a database that
	// replicates between the two browsers like any other. Granting somebody who
	// has just arrived can therefore land before their key does, and the app
	// says so in as many words rather than pretending the grant was complete.
	//
	// So this does what the panel tells a person to do, and it fails for real if
	// the message never clears: a wait would hide the difference between "the
	// key arrived late" and "the key never arrives".
	for (let attempt = 1; attempt <= 5; attempt++) {
		await page.getByTestId('permission-did-input').fill(did);
		await page.getByTestId('permission-add').click();
		await expect(page.locator(`[data-testid="permission-entry"][data-did="${did}"]`)).toBeVisible({
			timeout
		});

		const notice = page.getByTestId('permission-error');
		if ((await notice.count()) === 0) return;
		if (!/published no encryption key yet/.test((await notice.textContent()) ?? '')) return;

		await page.waitForTimeout(3000);
	}

	throw new Error(`granting ${did} never handed over the list key`);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodoOk(page, text) {
	await todoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({ timeout });
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
async function expectNoTodo(page, text) {
	// Give replication a moment, then assert absence.
	await page.waitForTimeout(3000);
	await expect(page.getByText(text, { exact: true })).toHaveCount(0);
}

/** @param {import('@playwright/test').Page} page */
function todoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
