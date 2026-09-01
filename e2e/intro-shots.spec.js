import { test, expect } from '@playwright/test';
import { PREVIEW_ORIGIN } from './preview-origin.mjs';

/**
 * The four states, photographed.
 *
 * Light and dark are independent of simple and technical, so it is four
 * pictures per language rather than two. A section that renders in one theme
 * and vanishes in the other, or that has a simple text and no technical one,
 * does not show up in a single screenshot taken in whichever theme the machine
 * happened to be in.
 */

const shot = async (page, { theme, technical, lang, name }) => {
	await page.emulateMedia({ colorScheme: theme });
	await page.addInitScript(
		([viewKey, viewValue, langKey, langValue]) => {
			try {
				localStorage.setItem(viewKey, viewValue);
				localStorage.setItem(langKey, langValue);
			} catch {
				// Storage blocked: the shot still renders, in the defaults.
			}
		},
		['qr01.simpleView', technical ? 'false' : 'true', 'qr01.locale', lang]
	);
	await page.goto(PREVIEW_ORIGIN);
	await page.locator('qr-intro').waitFor({ state: 'attached', timeout: 30_000 });
	// The measurement settles the verdict line; without the wait the panel is
	// photographed mid-check and every picture says "checking".
	await page.waitForTimeout(6000);
	await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}.png`, fullPage: true });
};

for (const lang of ['de', 'en']) {
	for (const theme of /** @type {const} */ (['light', 'dark'])) {
		for (const technical of [false, true]) {
			const name = `qr01-${lang}-${theme}-${technical ? 'technical' : 'simple'}`;
			test(name, async ({ page }) => {
				test.setTimeout(90_000);
				await shot(page, { theme, technical, lang, name });
			});
		}
	}
}

/**
 * The same dialog with the relay ticked.
 *
 * Three paragraphs and one privacy clause describe carrying a code between two
 * phones. A relay replaces that way in, so leaving them there would describe a
 * different app than the one the switch just configured.
 */
test('with the relay ticked, the code story is gone', async ({ page }) => {
	test.setTimeout(90_000);
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto(PREVIEW_ORIGIN);
	await page.locator('qr-intro').waitFor({ state: 'attached', timeout: 30_000 });

	await expect(page.getByTestId('intro-qr-story').first()).toBeVisible();
	await expect(page.getByTestId('intro-warning')).toBeVisible();

	const relayBox = page.locator('qr-intro').locator('css=.relay input[type="checkbox"]');
	await relayBox.check();

	await expect(page.getByTestId('intro-qr-story')).toHaveCount(0);
	await page.screenshot({ path: `${process.env.SHOT_DIR}/qr01-relay-on.png`, fullPage: true });
});
