import { test, expect } from '@playwright/test';

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
		await openReadyAppWithNewPasskey(owner, {
			userId: `${ownerName.toLowerCase()}-${runId}@example.com`,
			displayName: ownerName
		});
		await createPrivateList(owner);
		await addTodoOk(owner, ownerTodo);
		const dbAddress = await getActiveDatabaseAddress(owner);
		const guestDid = await (async () => {
			// 2. Guest opens the same list by address (read/replication works).
			await openReadyAppWithNewPasskey(guest, {
				userId: `${guestName.toLowerCase()}-${runId}@example.com`,
				displayName: guestName
			});
			await openListByAddress(guest, dbAddress);
			return getOwnDid(guest);
		})();

		// 3. Guest sees the owner's todo.
		await expectTodo(guest, ownerTodo);

		// 4. Guest write MUST fail; UI shows an error; the list stays unchanged.
		await addTodoExpectDenied(guest, guestTodo);
		await expectNoTodo(guest, guestTodo);
		await expectNoTodo(owner, guestTodo);

		// 5. Owner grants the guest's DID write access.
		await grantWriteAccess(owner, guestDid);

		// 6. Guest retries → success; both see both todos.
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
 * @param {{ userId: string, displayName: string }} identity
 */
async function openReadyAppWithNewPasskey(page, { userId, displayName }) {
	await page.goto(testUrl);
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();
	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	await page.getByTestId('identity-mode-create').check();
	await page.getByTestId('passkey-user-id').fill(userId);
	await page.getByTestId('passkey-display-name').fill(displayName);
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
	await page.getByTestId('permission-did-input').fill(did);
	await page.getByTestId('permission-add').click();
	await expect(page.locator(`[data-testid="permission-entry"][data-did="${did}"]`)).toBeVisible({
		timeout
	});
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
