import { writable } from 'svelte/store';
import { createIntroPolicy } from '@le-space/libp2p-webrtc-qr';

/**
 * Whether the first-launch introduction is showing.
 *
 * Kept out of the component so the dismissal survives the component being
 * unmounted and remounted — `{#if $initializationStore.isInitialized}` does
 * exactly that on every identity change, and a dialog that reappeared each
 * time somebody adopted a passkey would be worse than no dialog.
 *
 * *When* it opens is the package's decision now. `createIntroPolicy` carries
 * the same three rules this file used to spell out — no dialog for someone who
 * arrived by invite, show it when storage is unreadable, dismissal is not a
 * one-way door — and carries them for every app that shows an introduction
 * rather than for this one. What stays here is the Svelte store, because a
 * store is what our components subscribe to.
 */
export const INTRO_DIALOG_STORAGE_KEY = 'qr01.introSeen';

const policy = createIntroPolicy({ storageKey: INTRO_DIALOG_STORAGE_KEY });

export const introOpen = writable(false);

/**
 * Open it on a first visit, and never on a repeat one.
 *
 * @param {{ arrivedViaInvite?: boolean }} [options]
 */
export function hydrateIntro({ arrivedViaInvite = false } = {}) {
	introOpen.set(policy.shouldOpen({ arrivedViaInvite }));
}

/**
 * @param {boolean} rememberDismissal whether "don't show again" was ticked
 */
export function closeIntro(rememberDismissal) {
	introOpen.set(false);
	if (rememberDismissal) policy.remember();
}

/**
 * Reopen it from the header — dismissing must not be a one-way door.
 *
 * Deliberately not `policy.forget()`: that clears the stored dismissal so the
 * dialog returns on the *next* launch too. Somebody pressing the header button
 * wants to read it now, not to undo a decision they made once.
 */
export function openIntro() {
	introOpen.set(true);
}
