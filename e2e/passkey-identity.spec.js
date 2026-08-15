import { test, expect } from '@playwright/test';
import { SPANISH_MNEMONIC_STORAGE_KEY } from '../src/lib/spanish-mnemonic.js';

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

			await Promise.all([
				openReadyAppWithNewPasskey(alice, {
					userId: `alice-${runId}@example.com`,
					displayName: 'Alice'
				}),
				openReadyAppWithNewPasskey(bob, { userId: `bob-${runId}@example.com`, displayName: 'Bob' })
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
 * @param {{ userId: string, displayName: string }} identity
 */
async function openReadyAppWithNewPasskey(page, { userId, displayName }) {
	await seedSharedList(page);
	await page.goto(testUrl);
	// qr01 opens anonymously with no gate, then upgrades on a real click.
	await expectAppReady(page);

	await page.getByTestId('identity-create-toggle').click();
	await page.getByTestId('identity-user-id').fill(userId);
	await page.getByTestId('identity-display-name').fill(displayName);
	await page.getByTestId('identity-create').click();

	await expectAppReady(page);
}

/** @param {import('@playwright/test').Page} page */
async function proceedWithExistingPasskey(page) {
	// Nothing is preselected any more: a reloaded session is anonymous until
	// the passkey is restored, which is what this click does.
	await expectAppReady(page);
	await page.getByTestId('identity-recover').click();
	await expectAppReady(page);
}

/**
 * Pin the shared list before the page runs.
 *
 * The mnemonic used to be typed into the consent modal. With no modal, the app
 * reads it from storage on mount, so the test writes it there instead of
 * opening one list and restarting onto another.
 *
 * @param {import('@playwright/test').Page} page
 */
async function seedSharedList(page) {
	await page.addInitScript(
		([key, value]) => {
			try {
				localStorage.setItem(key, value);
			} catch {
				// Storage blocked; the assertion that needs this list will say so.
			}
		},
		[SPANISH_MNEMONIC_STORAGE_KEY, sharedMnemonic]
	);
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
	const row = page.locator('div.flex-1').filter({ has: page.getByText(text, { exact: true }) });
	await expect(row.getByTestId('todo-author')).toHaveAttribute('data-author', expectedDid, {
		timeout: collaborationTimeout
	});
}

/** @param {import('@playwright/test').Page} page */
function getTodoInput(page) {
	return page.getByPlaceholder('What needs to be done?');
}
