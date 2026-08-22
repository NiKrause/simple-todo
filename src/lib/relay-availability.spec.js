import { beforeEach, describe, expect, it } from 'vitest';

import { RELAY_OPT_IN_STORAGE_KEY, readStoredRelayOptIn } from './relay-availability.js';

// The ordering rule — shipped addresses before any directory, and what a
// directory returns probed rather than trusted — moved into
// `@le-space/libp2p-webrtc-qr`, where it is the same decision for every app
// built on that transport, and where it is covered by its own tests. What is
// asserted here is what only this app can answer.

describe('the stored choice', () => {
	beforeEach(() => localStorage.removeItem(RELAY_OPT_IN_STORAGE_KEY));

	it('is off until somebody turns it on', () => {
		// Read straight from storage rather than through the store, because this
		// is the answer `createLibp2pConfig` needs before any component mounts —
		// and "off" there is the promise, not a preference.
		expect(readStoredRelayOptIn()).toBe(false);
	});

	it('reads what the dialog wrote, under the key they share', () => {
		// `<qr-intro>` owns the writing now. If these two ever disagreed about the
		// key or the encoding, a remembered yes would leave the checkbox ticked
		// and the node relay-less — the two halves of one promise, silently apart.
		localStorage.setItem(RELAY_OPT_IN_STORAGE_KEY, 'true');
		expect(readStoredRelayOptIn()).toBe(true);

		localStorage.setItem(RELAY_OPT_IN_STORAGE_KEY, 'false');
		expect(readStoredRelayOptIn()).toBe(false);
	});
});
