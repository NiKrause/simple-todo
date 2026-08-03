import { test, expect } from '@playwright/test';

/**
 * Two lists that could not see each other, joined by a scanned code.
 *
 * `?transport=qr` strips this app down to one transport: no relay, no
 * bootstrap, no pubsub discovery, nothing that can find a peer by itself. That
 * is what makes the result mean something - if these two peers end up sharing a
 * list, the invite is the only thing that could have introduced them, and the
 * test proves the isolation before it proves the merge.
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
});

/** @param {import('@playwright/test').Page} page */
async function openInviteOnlyApp(page) {
	await page.goto('/?transport=qr');

	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();

	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}

	await page.getByRole('button', { name: 'Proceed to Test the App' }).click();
	await expect(modal).not.toBeVisible();
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
	await expect(alice.locator('qr-code img, [data-testid="qr-code"] img').first()).toBeVisible({ timeout });
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
