import { expect } from '@playwright/test';
import { SPANISH_MNEMONIC_STORAGE_KEY } from '../src/lib/spanish-mnemonic.js';
import { VIEW_MODE_STORAGE_KEY } from '../src/lib/view-mode.js';
import { INTRO_DIALOG_STORAGE_KEY } from '../src/lib/intro-dialog.js';
import { RELAY_OPT_IN_STORAGE_KEY } from '../src/lib/relay-availability.js';

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

/** @param {import('@playwright/test').Page} page */
export function todoInput(page) {
	return page.getByTestId('todo-input');
}

/**
 * Bring a tabbed list control on screen.
 *
 * Handing a list over is the first tab and the one the app opens on, so the
 * controls for making and opening lists now start off screen. Specs that reach
 * for them have to open their tab first, the way a person would — going through
 * `data-testid` rather than the tab's visible label, which is translated.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'transfer' | 'create' | 'open'} tab
 */
export async function openListTab(page, tab) {
	const control = page.getByTestId(`list-tab-${tab}`);
	await control.waitFor({ state: 'visible' });
	await control.click();
}

/**
 * Mark the first-launch introduction as already seen.
 *
 * Called by `openReadyApp` for every spec by default. The dialog covers the
 * page, so without this each existing spec would be clicking into an overlay
 * and failing on something that has nothing to do with what it tests. The spec
 * that is *about* the introduction opts out with `{ intro: true }`.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function seedIntroDismissed(page) {
	await page.addInitScript(
		([key, value]) => {
			try {
				localStorage.setItem(key, value);
			} catch {
				// Storage blocked: the dialog appears and whichever click it swallows
				// fails there, which names the dialog rather than this helper.
			}
		},
		[INTRO_DIALOG_STORAGE_KEY, 'true']
	);
}

/**
 * Pin the technical view before the page runs.
 *
 * The app opens in the simple view, which is the point of it — but that view
 * has no `SharedListDetails`, so `active-database-address` and the mnemonic
 * block simply do not exist in the DOM. Specs written before the simple view
 * read those elements, and they need the view the elements live in. Written to
 * storage rather than clicked, so the first render is already the right one.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function pinTechnicalView(page) {
	await page.addInitScript(
		([key, value]) => {
			try {
				localStorage.setItem(key, value);
			} catch {
				// Storage blocked: the app stays in the simple view and whichever
				// assertion needed a technical-view element fails there, naming that
				// element rather than naming storage.
			}
		},
		[VIEW_MODE_STORAGE_KEY, 'false']
	);
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
 * Consent to connecting through a relay before the page runs.
 *
 * The app now starts with no relay in its bootstrap list unless somebody ticks
 * the box, so a spec that expects replication over one has to say so. Called by
 * `openReadyApp` for every spec by default, because that is what every spec
 * silently got before the switch existed — the spec that is *about* the switch
 * opts out with `{ relay: false }`.
 *
 * Written to storage rather than clicked: `createLibp2pConfig` reads this while
 * building the node, so a later click would need the whole stack restarted.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function seedRelayOptIn(page) {
	await page.addInitScript(
		([key, value]) => {
			try {
				localStorage.setItem(key, value);
			} catch {
				// Storage blocked: the node starts without a relay and whichever
				// assertion needed one fails there, naming the connection rather
				// than naming storage.
			}
		},
		[RELAY_OPT_IN_STORAGE_KEY, 'true']
	);
}

/**
 * Navigate and wait until the app can actually be written to.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ url?: string, mnemonic?: string, timeout?: number, intro?: boolean, relay?: boolean }} [options]
 *   `intro: true` leaves the first-launch dialog in place; everything else gets
 *   it dismissed, because it covers the page. `relay: false` leaves the relay
 *   opt-in untouched, for the spec that asserts what an untouched start does.
 */
export async function openReadyApp(page, options = {}) {
	const { url = '/', mnemonic, timeout = 90_000, intro = false, relay = true } = options;
	if (!intro) await seedIntroDismissed(page);
	if (relay) await seedRelayOptIn(page);
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
 * The signal has to be *positive*. Waiting for the identity panel's buttons to
 * disappear looked reasonable and was not: those buttons sit inside
 * `{#if $initializationStore.isInitialized}` too, so they are momentarily
 * absent during any re-render, and `toBeHidden` fires on the first such moment
 * — before the restart has even begun. Measured: with that wait, the passkey
 * restart still landed *after* the next click, and the panels remounted
 * underneath it exactly as before.
 *
 * The DID badge is the honest signal, because `ownDidStore` is only set from
 * inside `createOrbitDBInstance` — deep in the rebuild. A `did:` value there
 * cannot exist until the new identity is genuinely live.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout]
 */
export async function waitForPasskeyAdopted(page, timeout = 90_000) {
	await expect(page.getByTestId('own-did-value')).toHaveAttribute('data-did', /^did:/, { timeout });
	await expectAppReady(page, timeout);
}
