import { writable } from 'svelte/store';

/**
 * Whether the first-launch introduction is showing.
 *
 * Kept out of the component so the dismissal survives the component being
 * unmounted and remounted — `{#if $initializationStore.isInitialized}` does
 * exactly that on every identity change, and a dialog that reappeared each
 * time somebody adopted a passkey would be worse than no dialog.
 */
export const INTRO_DIALOG_STORAGE_KEY = 'qr01.introSeen';

export const introOpen = writable(false);

function seen() {
	try {
		return localStorage.getItem(INTRO_DIALOG_STORAGE_KEY) === 'true';
	} catch {
		// Storage unavailable: show it. An introduction shown twice is a smaller
		// problem than a first-time user who never gets one.
		return false;
	}
}

/**
 * Open it on a first visit, and never on a repeat one.
 *
 * Deliberately not called when a shared link brought somebody here: that person
 * arrived to accept a list, and a dialog in front of it would be in the way of
 * the one thing they came to do. They see it on their next plain visit.
 *
 * @param {{ arrivedViaInvite?: boolean }} [options]
 */
export function hydrateIntro({ arrivedViaInvite = false } = {}) {
	if (arrivedViaInvite) return;
	introOpen.set(!seen());
}

/**
 * @param {boolean} rememberDismissal whether "don't show again" was ticked
 */
export function closeIntro(rememberDismissal) {
	introOpen.set(false);
	if (!rememberDismissal) return;
	try {
		localStorage.setItem(INTRO_DIALOG_STORAGE_KEY, 'true');
	} catch {
		// Nothing to do: it reappears next time, which is the safe direction.
	}
}

/** Reopen it from the header — dismissing must not be a one-way door. */
export function openIntro() {
	introOpen.set(true);
}
