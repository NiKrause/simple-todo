import { test, expect } from '@playwright/test';
import { openReadyApp, createPasskey, openListTab } from './open-app.mjs';
import { handshake, addVirtualAuthenticator } from './qr-handover.mjs';
import { SITE_TODOS } from '../src/lib/site-todos.js';

// Chapter (qr01), from a field test: on a building site Bob scans Alice's code
// before he has any passkey, because setting one up is an offer and not a toll
// gate. The list arrives. Then he sets a passkey up.
//
// The registry that remembers which lists you hold is keyed to a *signing
// identity*: `deriveRegistryName` hashes a signature over a fixed string, so a
// different identity means a different database, not a different row. Adopting
// a passkey therefore does not extend Bob's registry — it addresses a new one,
// and the entries are carried across explicitly (`registry-handoff.js`). This
// test is what says that carrying still happens.
//
// Run with E2E_RELAY_MODE=isolated: no relay, no bootstrap. The only
// introduction between the two browsers is the code.

const testUrl = '/';
const timeout = Number(process.env.E2E_STEP_TIMEOUT || 90_000);

test.describe('a passkey adopted after a handover', () => {
	test('keeps the list that arrived while anonymous', async ({ browser }) => {
		test.setTimeout(timeout * 4);

		const aliceContext = await browser.newContext();
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			// Bob gets an authenticator but deliberately no passkey yet: the point
			// is that the list arrives *before* he has an identity worth the name.
			await addVirtualAuthenticator(bob);

			await Promise.all([
				openReadyApp(alice, { url: testUrl, timeout }),
				openReadyApp(bob, { url: testUrl, timeout })
			]);

			await openListTab(alice, 'create');
			await alice.getByTestId('new-list-seed-site').click();
			await expect(alice.getByTestId('new-list-created')).toBeVisible({ timeout });
			const aliceAddress = await databaseAddress(alice);

			await handshake(alice, bob, { timeout });

			await expect(bob.getByTestId('list-offer-dialog')).toBeVisible({ timeout });
			await bob.getByTestId('list-offer-accept').click();
			await expect(bob.getByTestId('list-offer-dialog')).toBeHidden({ timeout });

			// Precondition, so a failure below cannot be blamed on the handover:
			// anonymous Bob really does hold the list.
			for (const todo of SITE_TODOS) {
				await expect(bob.getByText(todo, { exact: true })).toBeVisible({ timeout });
			}
			expect(await databaseAddress(bob)).toBe(aliceAddress);
			await openListTab(bob, 'create');
			await expect(bob.getByTestId('list-switcher')).toContainText('Excavation and basement', {
				timeout
			});
			const anonymousRegistry = await registryName(bob);
			expect(anonymousRegistry).toBeTruthy();

			// Now the thing a person actually does: set up a passkey afterwards,
			// having been told it identifies them to the people they hand lists to.
			const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
			// `createPasskey` waits for `own-did-value` to carry a `did:`. That is a
			// *positive* signal here and not a race: the badge renders only inside
			// `{#if usingPasskey}`, so while anonymous the element does not exist at
			// all — it cannot report the identity that is about to be replaced.
			await createPasskey(bob, {
				userId: `bob-${runId}@example.com`,
				displayName: 'Bob',
				timeout
			});

			// The registry is a different database now. That is the mechanism; it is
			// recorded here so a failure downstream reads as "identity swapped the
			// registry" rather than "the switcher is flaky".
			const passkeyRegistry = await registryName(bob);
			expect(passkeyRegistry).not.toBe(anonymousRegistry);

			// What the user expects: the list they were just handed is still theirs.
			//
			// Short timeout on purpose. The restart has already completed — the DID
			// badge above is the proof — so the switcher either has the entry now or
			// never will, and waiting the full 90s to watch it not appear only makes
			// the failure slower to read.
			await openListTab(bob, 'create');
			await expect(bob.getByTestId('list-switcher')).toContainText('Excavation and basement', {
				timeout: 15_000
			});

			// And it is still the list, not just a row: the items are readable, and
			// exactly one entry points at Alice's address rather than two.
			await bob
				.locator(`[data-testid="list-switcher-open"][data-address="${aliceAddress}"]`)
				.click();
			for (const todo of SITE_TODOS) {
				await expect(bob.getByText(todo, { exact: true })).toBeVisible({ timeout });
			}
			await expect(
				bob.locator(`[data-testid="list-switcher-open"][data-address="${aliceAddress}"]`)
			).toHaveCount(1);
		} finally {
			await bobContext.close();
			await aliceContext.close();
		}
	});
});

/** @param {import('@playwright/test').Page} page */
function databaseAddress(page) {
	return page.evaluate(() => window.__simpleTodoE2E.getDatabaseAddress());
}

/**
 * Which registry database this identity is using, read off the switcher rather
 * than recomputed, so the test cannot disagree with the app about it.
 *
 * Returns null when the switcher is absent, which is itself the symptom: after
 * adopting a passkey the registry is empty, so nothing renders. Waiting on
 * `getAttribute` there would burn the whole test timeout — and a timeout is not
 * an expected failure, so it would defeat the `test.fail()` above and report
 * this known defect as an ordinary broken test.
 *
 * @param {import('@playwright/test').Page} page
 */
async function registryName(page) {
	const switcher = page.getByTestId('list-switcher');
	if ((await switcher.count()) === 0) return null;
	return switcher.getAttribute('data-registry-name');
}
