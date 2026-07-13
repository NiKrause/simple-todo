import { writable } from 'svelte/store';

/** @typedef {{ origin: string, peerId: string }} RelayHttpStatus */

export const relayHttpStatusStore = writable(
	/** @type {RelayHttpStatus} */ ({
		origin: '',
		peerId: ''
	})
);
