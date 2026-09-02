import { expect } from '@playwright/test';

/**
 * Getting past the consent screen, in one place.
 *
 * The dialog is `qr-intro` now, so two of its controls live in the element's
 * shadow tree: the acceptance tick that gates the way out, and "don't show this
 * again". Seven specs used to reach into the markup for those, each with its own
 * selector - and each would have to learn where they moved. They ask here
 * instead.
 *
 * The parts are the contract: `part="accept"` and `part="dont-show"` are what
 * the element exposes, and they survive its internals being rearranged.
 */

/** @param {import('@playwright/test').Page} page */
export const consentModal = (page) => page.getByTestId('consent-modal');

/**
 * Whether the dialog is showing.
 *
 * Asked of the element rather than measured: the host is a custom element whose
 * dialog is in the shadow tree and positioned by the browser, so the host itself
 * measures zero either way. `toBeVisible` on it answers the wrong question.
 *
 * @param {import('@playwright/test').Page} page
 */
export const isConsentOpen = (page) =>
	page.evaluate(() => document.querySelector('[data-testid="consent-modal"]')?.isOpen === true);

/**
 * Whether the statement has been accepted.
 *
 * @param {import('@playwright/test').Page} page
 */
export const isAccepted = (page) =>
	page.evaluate(
		() =>
			document
				.querySelector('[data-testid="consent-modal"]')
				?.shadowRoot?.querySelector('input[part=accept]')?.checked === true
	);

/** @param {import('@playwright/test').Page} page */
export async function waitForConsent(page, { timeout = 30_000 } = {}) {
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen === true,
		undefined,
		{ timeout }
	);
}

/**
 * Tick the acceptance, which is what enables the way out.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function acceptNotice(page) {
	await page.evaluate(() => {
		const box = document
			.querySelector('[data-testid="consent-modal"]')
			?.shadowRoot?.querySelector('input[part=accept]');
		if (!box) throw new Error('the acceptance tick is not in the dialog');
		box.checked = true;
		box.dispatchEvent(new Event('change'));
	});
}

/**
 * Remember the decision, so the dialog does not return on the next load.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function rememberDecision(page) {
	await page.evaluate(() => {
		const box = document
			.querySelector('[data-testid="consent-modal"]')
			?.shadowRoot?.querySelector('input[part=dont-show]');
		if (!box) throw new Error('the do-not-show tick is not in the dialog');
		box.checked = true;
		box.dispatchEvent(new Event('change'));
	});
}

/**
 * The whole walk: set the choices, accept, proceed.
 *
 * `relay` and `persistent` default to what the app defaults to, so a caller
 * that does not care about them says nothing about them.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ relay?: boolean, persistent?: boolean, remember?: boolean }} [choices]
 */
export async function passConsent(page, { relay, persistent, remember = false } = {}) {
	await waitForConsent(page);

	if (persistent !== undefined) {
		await page
			.getByTestId(persistent ? 'consent-storage-indexeddb' : 'consent-storage-memory')
			.check();
	}
	if (relay !== undefined) {
		const box = page.getByTestId('consent-relay-network');
		if (relay) await box.check();
		else await box.uncheck();
	}
	if (remember) await rememberDecision(page);

	await acceptNotice(page);
	await page.getByTestId('consent-proceed').click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen !== true
	);
}
