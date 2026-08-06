import { isQrTransportMode } from './qr-transport.js';

/**
 * Which of the two introduction mechanisms this browser uses.
 *
 * The choice is made on the consent screen and has to outlive it: consent can be
 * remembered, in which case the modal never renders again and `initializeP2P()`
 * runs straight from `onMount`. A choice that lived only in the modal would be
 * unreachable for exactly the users who visit most often.
 */
const STORAGE_KEY = 'simpleTodo.relayNetworkEnabled';

/**
 * Defaults to true: the relay network is what makes this a demo two strangers
 * can try, and switching it off leaves a node nobody can reach without an
 * invite handed over by other means.
 *
 * @returns {boolean}
 */
export function getRelayNetworkEnabled() {
	if (typeof localStorage === 'undefined') {
		return true;
	}

	try {
		return localStorage.getItem(STORAGE_KEY) !== 'false';
	} catch {
		// Private browsing modes can throw on access rather than return null.
		return true;
	}
}

/**
 * @param {boolean} enabled
 */
export function setRelayNetworkEnabled(enabled) {
	if (typeof localStorage === 'undefined') {
		return;
	}

	try {
		localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
	} catch {
		// Not being able to remember the choice is survivable; the session still
		// honours it because the caller passes it on directly.
	}
}

/**
 * `?transport=qr` still wins over the stored preference. It is the isolated mode
 * the E2E relies on, and a URL that promises "no relay" must not quietly grow
 * one because this browser once ticked a box.
 *
 * @returns {boolean}
 */
export function isRelayNetworkMode() {
	if (isQrTransportMode()) {
		return false;
	}

	return getRelayNetworkEnabled();
}
