import { test, expect } from '@playwright/test';

// Chapter (passkey01): Alice and Bob each register a WebAuthn passkey in
// their own browser context (CDP virtual authenticator), write todos into
// the shared list, and both see every todo attributed to the correct author
// DID (resolved from entry.identity). A reload then recovers Alice's
// identity through the create-or-recover flow — the DID stays identical.

const testUrl = '/';
const collaborationTimeout = 90000;
const sharedMnemonic = 'bosque-coral-brisa';

test.describe('Passkey identities', () => {
	test('Alice and Bob write with passkey DIDs and recovery keeps the DID stable', async ({
		browser
	}) => {
		test.setTimeout(collaborationTimeout * 4);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const aliceTodo = `alice-${runId}-passkey-todo`;
		const bobTodo = `bob-${runId}-passkey-todo`;

		try {
			await Promise.all([addVirtualAuthenticator(alice), addVirtualAuthenticator(bob)]);

			// Deliberately the same label on both sides. The passkey is identified by
			// its random user handle, not by what is typed here, so two people who
			// pick the same name still get two identities. Before the handle became
			// random this would have been a collision — on one device the second
			// registration replaced the first.
			await Promise.all([
				openReadyAppWithNewPasskey(alice, { label: 'Alex' }),
				openReadyAppWithNewPasskey(bob, { label: 'Alex' })
			]);

			const aliceDid = await getOwnDid(alice);
			const bobDid = await getOwnDid(bob);
			expect(aliceDid).toMatch(/^did:/);
			expect(bobDid).toMatch(/^did:/);
			expect(aliceDid).not.toBe(bobDid);

			await addTodo(alice, aliceTodo);
			await addTodo(bob, bobTodo);

			// Both peers see both todos, each attributed to its author's DID.
			for (const page of [alice, bob]) {
				await expectTodoWithAuthor(page, aliceTodo, aliceDid);
				await expectTodoWithAuthor(page, bobTodo, bobDid);
			}

			// Reload → the app preselects passkey recovery; the DID must survive.
			await alice.reload();
			await proceedWithExistingPasskey(alice);
			const recoveredDid = await getOwnDid(alice);
			expect(recoveredDid).toBe(aliceDid);
			await expectTodoWithAuthor(alice, aliceTodo, aliceDid);
		} finally {
			await bobContext.close();
			await aliceContext.close();
		}
	});
});

/**
 * Attach a CTAP2.1 virtual authenticator (resident keys + largeBlob) so
 * WebAuthn ceremonies run without any OS dialog.
 * @param {import('@playwright/test').Page} page
 */
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
	const modal = await fillConsentModal(page);

	await page.getByTestId('identity-mode-create').check();
	await page.getByTestId('passkey-label').fill(label);

	await page.getByRole('button', { name: 'Open shared list' }).click();
	await expect(modal).not.toBeVisible({ timeout: collaborationTimeout });
	await expectAppReady(page);
}

/** @param {import('@playwright/test').Page} page */
async function proceedWithExistingPasskey(page) {
	const modal = await fillConsentModal(page);
	// A remembered passkey session preselects "Use an existing passkey".
	await expect(page.getByTestId('identity-mode-existing')).toBeChecked();
	await page.getByRole('button', { name: 'Open shared list' }).click();
	await expect(modal).not.toBeVisible({ timeout: collaborationTimeout });
	await expectAppReady(page);
}

/** @param {import('@playwright/test').Page} page */
async function fillConsentModal(page) {
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();
	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	await modal.getByTestId('shared-list-mnemonic-input').fill(sharedMnemonic);
	return modal;
}

/** @param {import('@playwright/test').Page} page */
async function expectAppReady(page) {
	await expect(getTodoInput(page)).toBeVisible();
	await expect(getTodoInput(page)).toBeEnabled({ timeout: collaborationTimeout });
}

/** @param {import('@playwright/test').Page} page */
async function getOwnDid(page) {
	const badge = page.getByTestId('own-did-value');
	await expect(badge).toBeVisible({ timeout: collaborationTimeout });
	const did = await badge.getAttribute('data-did');
	if (!did) throw new Error('own DID badge has no data-did attribute');
	return did;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 */
async function addTodo(page, text) {
	await getTodoInput(page).fill(text);
	await page.getByRole('button', { name: 'Add TODO' }).click();
	await expect(page.getByText(text, { exact: true })).toBeVisible({
		timeout: collaborationTimeout
	});
}

/**
 * The todo must be visible AND carry the writer's DID in its author field —
 * resolved from entry.identity, not from the (spoofable) todo payload.
 * @param {import('@playwright/test').Page} page
 * @param {string} text
 * @param {string} expectedDid
 */
async function expectTodoWithAuthor(page, text, expectedDid) {
	const row = page
		.locator('div.flex-1')
		.filter({ has: page.getByText(text, { exact: true }) });
	await expect(row.getByTestId('todo-author')).toHaveAttribute('data-author', expectedDid, {
		timeout: collaborationTimeout
	});
}

/** @param {import('@playwright/test').Page} page */
function getTodoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
