import { writable } from 'svelte/store';
import { findReachableRelays, readRelayOptIn, writeRelayOptIn } from '@le-space/libp2p-webrtc-qr';

// The search itself is the package's, and was already word for word the same
// function - baked-in addresses probed before discovery, discovered ones probed
// too because a registration can outlive the machine it describes. What is
// local is only which addresses this app ships with and where it keeps the
// choice.
export { findReachableRelays };

/**
 * Connecting through a relay: off unless somebody asks for it.
 *
 * The app's promise is that it needs no server. A relay is the second way in,
 * for the case the QR path cannot serve — the other person is not here to scan
 * anything. So the switch defaults to off, and a start without it makes no
 * outbound call at all. Ticking it starts the check immediately, because the
 * useful answer is "a relay answers" or "none does", not "a relay might exist".
 */
export const RELAY_OPT_IN_STORAGE_KEY = 'qr01.relayOptIn';

export const relayOptIn = writable(false);

/**
 * What the last check found, for anything outside the dialog.
 *
 * `'none'` is the one worth acting on: somebody asked for a relay and there is
 * none to be had, which is exactly when starting one is worth offering. The
 * other values are the dialog's business.
 *
 * @type {import('svelte/store').Writable<'idle' | 'waiting' | 'checking' | 'baked' | 'aleph' | 'none'>}
 */
export const relayVerdict = writable(/** @type {any} */ ('idle'));

/**
 * The stored choice, read without a store subscription.
 *
 * `libp2p-config` needs the answer while it builds the node, before any
 * component has mounted, so it cannot wait for `hydrateRelayOptIn`.
 *
 * @returns {boolean}
 */
export function readStoredRelayOptIn() {
	// `globalThis.localStorage` rather than the bare name: this runs during
	// prerendering too, where the bare name is a ReferenceError and the property
	// is simply undefined - which `readRelayOptIn` already reads as "off".
	return readRelayOptIn(globalThis.localStorage, RELAY_OPT_IN_STORAGE_KEY);
}

/** Called once on mount: `localStorage` does not exist while prerendering. */
export function hydrateRelayOptIn() {
	relayOptIn.set(readStoredRelayOptIn());
}

export function setRelayOptIn(/** @type {boolean} */ next) {
	relayOptIn.set(next);
	// A blocked store loses the choice after this session, which is the safe
	// direction and the package's behaviour too.
	writeRelayOptIn(globalThis.localStorage, RELAY_OPT_IN_STORAGE_KEY, next);
}
