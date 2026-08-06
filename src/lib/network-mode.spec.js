import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	getRelayNetworkEnabled,
	isRelayNetworkMode,
	setRelayNetworkEnabled
} from './network-mode.js';

const STORAGE_KEY = 'simpleTodo.relayNetworkEnabled';

describe('relay network preference', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('defaults to on, so a first visit joins the public relay network', () => {
		expect(getRelayNetworkEnabled()).toBe(true);
	});

	it('round-trips the choice so a remembered consent still honours it', () => {
		// The modal never renders again once consent is remembered, so the stored
		// value is the only carrier of the decision on later visits.
		setRelayNetworkEnabled(false);
		expect(getRelayNetworkEnabled()).toBe(false);

		setRelayNetworkEnabled(true);
		expect(getRelayNetworkEnabled()).toBe(true);
	});

	it('treats only an explicit "false" as off', () => {
		// Anything else — absent, empty, garbage from an older build — must not
		// silently strand a browser with no way to reach a peer.
		localStorage.setItem(STORAGE_KEY, 'nonsense');
		expect(getRelayNetworkEnabled()).toBe(true);

		localStorage.setItem(STORAGE_KEY, 'false');
		expect(getRelayNetworkEnabled()).toBe(false);
	});

	it('survives storage that throws instead of returning null', () => {
		// Private browsing modes can reject access outright; the app has to start
		// anyway rather than fail before the first render.
		vi.stubGlobal('localStorage', {
			getItem() {
				throw new Error('access denied');
			},
			setItem() {
				throw new Error('access denied');
			}
		});

		expect(getRelayNetworkEnabled()).toBe(true);
		expect(() => setRelayNetworkEnabled(false)).not.toThrow();
	});
});

describe('isRelayNetworkMode', () => {
	beforeEach(() => {
		localStorage.clear();
		window.history.replaceState({}, '', '/');
	});

	it('follows the stored preference on a normal URL', () => {
		expect(isRelayNetworkMode()).toBe(true);

		setRelayNetworkEnabled(false);
		expect(isRelayNetworkMode()).toBe(false);
	});

	it('lets ?transport=qr override a stored preference of on', () => {
		// That URL promises a node with no relay at all — the mode the isolation
		// E2E rests on. A box ticked once in this browser must not grow one back.
		setRelayNetworkEnabled(true);
		window.history.replaceState({}, '', '/?transport=qr');

		expect(isRelayNetworkMode()).toBe(false);
	});
});
