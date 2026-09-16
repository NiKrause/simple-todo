import { test, expect } from '@playwright/test';
import { RelayButtonDriver } from '@le-space/playwright';

import { passConsent } from './consent.mjs';
import { pinTechnicalView } from './technical-view.mjs';

/**
 * The launcher floats over the bottom-right corner, and on a phone that corner
 * is over the app: the balance card and the todo rows scroll underneath it.
 * `draggable` is what lets somebody move it out of the way, and
 * `positionStorageKey` is what keeps it there on the next visit.
 *
 * Ported from qr01 (#295). The pointer sequence comes from `RelayButtonDriver`
 * rather than being written here: the drag threshold, the clamping and the
 * storage format are the widget's, not this app's (relay-button#117).
 *
 * The launcher loads with the P2P stack, so it only exists once the consent
 * dialog has been passed.
 */

const timeout = 90_000;
const POSITION_KEY = 'simpleTodo.relayFabPosition';

const viewports = [
	{ name: 'desktop', viewport: { width: 1280, height: 900 } },
	{ name: 'phone', viewport: { width: 390, height: 844 } }
];

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ remember?: boolean }} [options]
 */
async function openWithLauncher(page, { remember = false } = {}) {
	// The launcher is the technical view's: the simple view does not render it.
	await pinTechnicalView(page);
	await page.goto('/');
	await passConsent(page, { remember });
	await expect(page.getByPlaceholder('What needs to be done?')).toBeEnabled({ timeout });
	return new RelayButtonDriver(page);
}

for (const { name, viewport } of viewports) {
	test.describe(`the relay button can be moved out of the way (${name})`, () => {
		test.use({ viewport });

		test('a drag moves it, and the next visit finds it where it was left', async ({ page }) => {
			// Consent is remembered, so the reload starts the app, and with it the
			// launcher, without the dialog in between.
			const driver = await openWithLauncher(page, { remember: true });

			const resting = await driver.launcherBox();
			expect(resting.x).toBeGreaterThanOrEqual(0);
			expect(resting.y).toBeGreaterThanOrEqual(0);
			expect(resting.x + resting.width).toBeLessThanOrEqual(viewport.width);
			expect(resting.y + resting.height).toBeLessThanOrEqual(viewport.height);

			const { before, after } = await driver.dragLauncherBy(-160, -120);

			// Up and to the left, by roughly what was asked. Not exactly: the
			// launcher grows a little under the pointer.
			expect(after.x).toBeLessThan(before.x - 100);
			expect(after.y).toBeLessThan(before.y - 80);

			const stored = await page.evaluate((key) => localStorage.getItem(key), POSITION_KEY);
			expect(stored, 'a drag the app forgets is a drag the user repeats').toBeTruthy();

			await page.reload();
			// Polled: the launcher is drawn in its CSS corner for a moment before the
			// widget applies the stored placement.
			await expect
				.poll(
					async () => {
						const box = await driver.launcherBox();
						return Math.abs(box.x - after.x) < 4 && Math.abs(box.y - after.y) < 4;
					},
					{ timeout: 15_000 }
				)
				.toBe(true);
		});

		test('a press that wobbles still opens the panel', async ({ page }) => {
			const driver = await openWithLauncher(page);
			const before = await driver.launcherBox();

			await driver.tapLauncherWithWobble();

			// The half of a drag threshold that fails silently: a launcher that reads
			// a one-pixel wobble as a drag never opens at all.
			await expect(driver.instanceNameField()).toBeVisible({ timeout: 15_000 });
			const after = await driver.launcherBox();
			expect(Math.abs(after.x - before.x)).toBeLessThan(6);
			expect(Math.abs(after.y - before.y)).toBeLessThan(6);
		});
	});
}

/**
 * Known upstream defect, pinned so it announces its own fix. In
 * `@le-space/ui` 0.9.6 a draggable launcher opens its panel on `pointerup`
 * only and drops its `click` handler, so Enter and Space on the focused
 * button do nothing. When the widget handles keyboard clicks again this test
 * starts passing, Playwright reports that as a failure, and `test.fail` goes.
 */
test.fail('Enter on the focused relay button opens the panel', async ({ page }) => {
	const driver = await openWithLauncher(page);
	await driver.launcher().focus();
	await page.keyboard.press('Enter');
	await expect(driver.instanceNameField()).toBeVisible({ timeout: 5_000 });
});
