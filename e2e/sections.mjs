import { expect } from '@playwright/test';

/**
 * Open one section of the page through its tab (escrow01).
 *
 * The page opens on the todos and keeps the lists, the account and the network
 * behind tabs. A section that is not open is hidden, not removed: a spec can
 * still read its text and attributes, but a click into it fails and
 * `toBeVisible` does too. So a spec opens the tab a person would open before it
 * acts in a section, and a helper that acts opens its own section rather than
 * trusting where the previous one left the page.
 *
 * Clicked, not navigated to: the click is the path people take, and it proves
 * the tab bar as well as the section. Does nothing when the tab is already open,
 * so calling it twice is harmless.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'aufgaben' | 'listen' | 'konto' | 'netzwerk'} section
 */
export async function openSection(page, section) {
	const tab = page.getByTestId(`tab-${section}`);
	if ((await tab.getAttribute('aria-current')) !== 'page') await tab.click();
	await expect(page.getByTestId(`section-${section}`)).toBeVisible();
}
