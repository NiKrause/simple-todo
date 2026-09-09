/**
 * Getting past the consent screen, in one place.
 *
 * The dialog is `qr-intro` now, so the acceptance tick that gates the way out
 * lives in the element's shadow tree. Ten specs used to reach into the markup
 * for it, each with its own selector — and each would have to learn where it
 * moved. They ask here instead.
 *
 * `part="accept"` and `part="dont-show"` are what the element exposes, and they
 * survive its internals being rearranged.
 */

/** @param {import('@playwright/test').Page} page */
export const consentModal = (page) => page.getByTestId('consent-modal');

/**
 * Whether the dialog is showing.
 *
 * Asked of the element rather than measured. The host is a custom element whose
 * dialog is in the shadow tree and positioned by the browser, so it measures
 * 0x0 once it has upgraded — and briefly has a box before that, while the
 * dialog is not open yet. `toBeVisible` is therefore wrong in both directions;
 * it cost `main` seven red runs of 1.3 hours each before anyone looked.
 *
 * @param {import('@playwright/test').Page} page
 */
export const isConsentOpen = (page) =>
	page.evaluate(() => document.querySelector('[data-testid="consent-modal"]')?.isOpen === true);

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [options]
 */
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
 * The whole walk: choose an identity, accept, proceed.
 *
 * `identity` defaults to what the app defaults to, so a caller that does not
 * care about it says nothing about it. `mnemonic` is left alone unless given —
 * the app generates a valid one, and most specs only need *a* shared list.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ identity?: 'anonymous' | 'create' | 'existing', label?: string, mnemonic?: string, remember?: boolean }} [choices]
 */
export async function passConsent(page, { identity, label, mnemonic, remember = false } = {}) {
	await waitForConsent(page);

	if (mnemonic !== undefined) {
		await page.getByTestId('shared-list-mnemonic-input').fill(mnemonic);
	}
	if (identity !== undefined) {
		await page.getByTestId(`identity-mode-${identity}`).check();
	}
	if (label !== undefined) {
		await page.getByTestId('passkey-label').fill(label);
	}
	if (remember) await rememberDecision(page);

	await acceptNotice(page);
	await page.getByTestId('consent-proceed').click();
	await page.waitForFunction(
		() => document.querySelector('[data-testid="consent-modal"]')?.isOpen !== true
	);
}
