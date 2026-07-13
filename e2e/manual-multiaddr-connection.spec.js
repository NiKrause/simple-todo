import { test, expect } from '@playwright/test';

const testUrl = '/';
const connectionTimeout = 90000;

test.describe('Manual browser connection using a copied own multiaddress', () => {
	test('Browser B connects with a multiaddress copied from Browser A', async ({ browser }) => {
		test.setTimeout(connectionTimeout * 2);

		const aliceContext = await browser.newContext({
			permissions: ['clipboard-read', 'clipboard-write']
		});
		const bobContext = await browser.newContext();
		const alice = await aliceContext.newPage();
		const bob = await bobContext.newPage();

		try {
			await openReadyApp(alice);
			const alicePeerId = await getPeerId(alice);
			await openNetworkDetails(alice);

			const addressList = alice.getByTestId('own-multiaddr-list');
			await expect(addressList).toBeVisible({ timeout: connectionTimeout });
			await expect
				.poll(() => addressList.evaluate((element) => getComputedStyle(element).overflowY))
				.toBe('auto');

			const copyButtons = alice.getByTestId('copy-own-multiaddr');
			await expect(copyButtons.first()).toBeVisible({ timeout: connectionTimeout });
			const ownAddresses = await copyButtons.evaluateAll((buttons) =>
				buttons.map((button) => button.getAttribute('data-multiaddr') ?? '')
			);
			const addressIndex = ownAddresses.findIndex(
				(address) =>
					address.includes('/ws') &&
					address.includes('/p2p-circuit') &&
					!address.includes('/webrtc') &&
					address.endsWith(`/p2p/${alicePeerId}`)
			);
			expect(
				addressIndex,
				`Expected a relay circuit address in ${ownAddresses.join(', ')}`
			).toBeGreaterThanOrEqual(0);

			await copyButtons.nth(addressIndex).click();
			await expect(copyButtons.nth(addressIndex)).toHaveAttribute('title', 'Copied!');
			const copiedAddress = await alice.evaluate(() => navigator.clipboard.readText());
			expect(copiedAddress).toBe(ownAddresses[addressIndex]);

			await openReadyApp(bob);
			await openNetworkDetails(bob);
			await bob.getByLabel('Use a custom multiaddress').check();
			await bob
				.getByPlaceholder('/dns4/example.com/tcp/443/wss/p2p/12D3KooW...')
				.fill(copiedAddress);
			await bob.getByRole('button', { name: 'Connect', exact: true }).click();

			await expect(bob.getByText('Connection stable', { exact: true })).toBeVisible({
				timeout: connectionTimeout
			});
			await expect
				.poll(
					() =>
						bob.evaluate(
							(peerId) =>
								window.__simpleTodoE2E
									?.getConnections?.()
									.some((connection) => connection.remotePeer === peerId) ?? false,
							alicePeerId
						),
					{ timeout: connectionTimeout }
				)
				.toBe(true);
		} finally {
			await bobContext.close();
			await aliceContext.close();
		}
	});
});

/** @param {import('@playwright/test').Page} page */
async function openReadyApp(page) {
	await page.goto(testUrl);
	const modal = page.locator('div.fixed.inset-0.z-50');
	await expect(modal).toBeVisible();
	for (const checkbox of await modal.locator('input[type="checkbox"]').all()) {
		await checkbox.check();
	}
	await page.getByRole('button', { name: 'Proceed to Test the App' }).click();
	await expect(modal).not.toBeVisible();
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({
		timeout: connectionTimeout
	});
}

/** @param {import('@playwright/test').Page} page */
async function openNetworkDetails(page) {
	const networkDetails = page.getByTestId('network-details');
	if ((await networkDetails.getAttribute('open')) === null) {
		await networkDetails.getByText('Network details', { exact: true }).click();
	}
	await expect(networkDetails).toHaveAttribute('open', '');
}

/** @param {import('@playwright/test').Page} page */
async function getPeerId(page) {
	await expect
		.poll(() => page.evaluate(() => window.__simpleTodoE2E?.getPeerId?.() ?? null), {
			timeout: connectionTimeout
		})
		.toBeTruthy();
	return page.evaluate(() => window.__simpleTodoE2E.getPeerId());
}
