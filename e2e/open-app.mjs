import { expect } from '@playwright/test';
import { SPANISH_MNEMONIC_STORAGE_KEY } from '../src/lib/spanish-mnemonic.js';

/**
 * Opening the app, for a chapter that has no consent screen.
 *
 * Every spec used to begin with the same twelve lines: wait for the modal,
 * tick its checkboxes, type a mnemonic into it, click "Open shared list".
 * qr01 deletes that modal — the app initialises itself on mount — so all of it
 * collapses into "go to the page and wait until you can type a todo".
 *
 * The mnemonic moves from a form field into storage, written *before* the page
 * runs so `onMount` reads it on the first pass. Driving the in-app list editor
 * instead would open one list only to restart the whole P2P stack onto another.
 *
 * Identity is separate on purpose. The app always starts anonymous, because
 * WebAuthn refuses to run outside a user gesture and `onMount` is not one, so a
 * spec that needs a passkey asks for one explicitly with `createPasskey` or
 * `restorePasskey` — each of which is a real click, which is the gesture.
 */

const TODO_INPUT = 'What needs to be done?';

/** @param {import('@playwright/test').Page} page */
export function todoInput(page) {
	return page.getByPlaceholder(TODO_INPUT);
}

/**
 * Pin the shared list before the page runs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} mnemonic
 */
export async function seedSharedList(page, mnemonic) {
	await page.addInitScript(
		([key, value]) => {
			try {
				localStorage.setItem(key, value);
			} catch {
				// Storage blocked: the app falls back to a generated mnemonic, and
				// whichever assertion needed this specific list will fail there,
				// where the message is about the list rather than about storage.
			}
		},
		[SPANISH_MNEMONIC_STORAGE_KEY, mnemonic]
	);
}

/**
 * Navigate and wait until the app can actually be written to.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ url?: string, mnemonic?: string, timeout?: number }} [options]
 */
export async function openReadyApp(page, options = {}) {
	const { url = '/', mnemonic, timeout = 90_000 } = options;
	if (mnemonic) await seedSharedList(page, mnemonic);
	await page.goto(url);
	await expectAppReady(page, timeout);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout]
 */
export async function expectAppReady(page, timeout = 90_000) {
	await expect(todoInput(page)).toBeVisible({ timeout });
	await expect(todoInput(page)).toBeEnabled({ timeout });
}

/**
 * Upgrade the running session to a fresh passkey identity.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ userId: string, displayName: string, timeout?: number }} identity
 */
export async function createPasskey(page, { userId, displayName, timeout = 90_000 }) {
	await page.getByTestId('identity-create-toggle').click();
	await page.getByTestId('identity-user-id').fill(userId);
	await page.getByTestId('identity-display-name').fill(displayName);
	await page.getByTestId('identity-create').click();
	await waitForPasskeyAdopted(page, timeout);
}

/**
 * Bring back the passkey identity this device already has.
 *
 * Needed after every reload: the app cannot prompt for WebAuthn on mount, so a
 * reloaded session is anonymous and the identity-keyed registry looks empty
 * until this runs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ timeout?: number }} [options]
 */
export async function restorePasskey(page, { timeout = 90_000 } = {}) {
	await expectAppReady(page, timeout);
	await page.getByTestId('identity-recover').click();
	await waitForPasskeyAdopted(page, timeout);
}

/**
 * Wait until the passkey identity is actually in effect.
 *
 * Not `expectAppReady`, and this distinction cost an afternoon. Adopting an
 * identity restarts the P2P stack, and a restart is asynchronous: for a moment
 * after the click the app is *still ready from before it*, so waiting for
 * "ready" succeeds immediately, against a stack that is about to be torn down.
 * `{#if $initializationStore.isInitialized}` then unmounts and remounts the
 * panels behind it — and anything typed into them in that window is silently
 * gone.
 *
 * That is exactly what happened: the list-name field was filled, the remount
 * cleared it, and the list was created under the default name. Every assertion
 * about the typed name failed while the app itself was working correctly.
 *
 * The identity panel's own state is the honest signal. Its create/recover
 * buttons live behind `{#if !usingPasskey}`, so their disappearance means the
 * new identity is live — which only happens once the restart has finished.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout]
 */
export async function waitForPasskeyAdopted(page, timeout = 90_000) {
	await expect(page.getByTestId('identity-create-toggle')).toBeHidden({ timeout });
	await expectAppReady(page, timeout);
}
