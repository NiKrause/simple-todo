import { writable } from 'svelte/store';

export const WEBRTC_ENABLED_STORAGE_KEY = 'simpleTodo.webrtcEnabled';

let currentWebRTCEnabled = true;

export const webrtcEnabledStore = writable(currentWebRTCEnabled);

webrtcEnabledStore.subscribe((enabled) => {
	currentWebRTCEnabled = enabled;
});

export function initializeWebRTCSetting() {
	if (typeof localStorage === 'undefined') return;

	const storedValue = localStorage.getItem(WEBRTC_ENABLED_STORAGE_KEY);
	if (storedValue == null) return;

	setWebRTCEnabled(storedValue !== 'false');
}

/**
 * @param {boolean} enabled
 */
export function setWebRTCEnabled(enabled) {
	currentWebRTCEnabled = enabled;
	webrtcEnabledStore.set(enabled);

	if (typeof localStorage === 'undefined') return;

	try {
		localStorage.setItem(WEBRTC_ENABLED_STORAGE_KEY, String(enabled));
	} catch {
		// Ignore browsers or modes where localStorage is unavailable.
	}
}

export function getWebRTCEnabled() {
	return currentWebRTCEnabled;
}
