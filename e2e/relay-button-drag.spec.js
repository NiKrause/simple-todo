import { test, expect } from '@playwright/test';
import { RelayButtonDriver } from '@le-space/playwright';

import { openReadyApp, pinTechnicalView } from './open-app.mjs';

/**
 * The launcher floats over the bottom-right corner, which on a phone is where
 * the app's own controls are — in the report that raised this it sat on top of
 * the "static code" checkbox. `draggable` is what lets somebody move it, and
 * until now nothing checked that it does.
 *
 * The pointer sequence comes from `RelayButtonDriver` rather than being written
 * here: the threshold, the clamping and the storage behaviour are the widget's,
 * not this app's, and a hand-rolled drag in each consumer tests a guess at them
 * (relay-button#117). It is also how the drag was found broken — 0.9.2 shipped
 * `initPlacement()` behind an `await controller.init()`, so `placement` stayed
 * null and the launcher could not move at all.
 */

const timeout = 90_000;
const POSITION_KEY = 'qr01.relayFabPosition';

test.describe('the relay button can be moved out of the way', () => {
	test('a drag moves it, and the next visit finds it where it was left', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			// The launcher lives in the technical view, so pin it: this is about
			// moving the button, not about which view shows it.
			await pinTechnicalView(page);
			await openReadyApp(page, { relay: false, timeout });

			const driver = new RelayButtonDriver(page);
			const { before, after } = await driver.dragLauncherBy(-160, -120);

			// Up and to the left, by roughly what was asked. Not exactly: the
			// launcher grows a little under the pointer, so the box is measured
			// against a generous margin rather than an exact offset.
			expect(after.x).toBeLessThan(before.x - 100);
			expect(after.y).toBeLessThan(before.y - 80);

			const stored = await page.evaluate((key) => localStorage.getItem(key), POSITION_KEY);
			expect(stored, 'a drag the app forgets is a drag the user repeats').toBeTruthy();

			// The point of remembering it: the next visit starts where it was left.
			await page.reload();
			await pinTechnicalView(page);
			const reopened = await driver.launcherBox();
			expect(Math.abs(reopened.x - after.x)).toBeLessThan(4);
			expect(Math.abs(reopened.y - after.y)).toBeLessThan(4);
		} finally {
			await context.close();
		}
	});

	test('a press that wobbles still opens the panel', async ({ browser }) => {
		const context = await browser.newContext();
		const page = await context.newPage();

		try {
			await pinTechnicalView(page);
			await openReadyApp(page, { relay: false, timeout });

			const driver = new RelayButtonDriver(page);
			const before = await driver.launcherBox();
			await driver.tapLauncherWithWobble();

			// The other half of a drag threshold, and the half that fails silently:
			// a launcher that reads a one-pixel wobble as a drag never opens, and
			// nothing about that looks like a bug in a drag test.
			await expect(driver.instanceNameField()).toBeVisible({ timeout: 15_000 });

			const after = await driver.launcherBox();
			expect(Math.abs(after.x - before.x)).toBeLessThan(6);
			expect(Math.abs(after.y - before.y)).toBeLessThan(6);
		} finally {
			await context.close();
		}
	});
});
