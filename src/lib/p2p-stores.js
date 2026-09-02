import { writable } from 'svelte/store';

/**
 * The p2p stores, deliberately in a module of their own.
 *
 * They are three `writable`s and nothing else, but they used to live in
 * `p2p.js` — which imports libp2p, Helia, OrbitDB and gossipsub. Reading a
 * store therefore pulled 1.6 MB of networking code into the page's eager
 * bundle, and the consent dialog could not render until all of it had arrived.
 * Over a slow connection that is tens of seconds of blank page, with no
 * loading state to explain it.
 *
 * Nothing here may import from `p2p.js`, or the split is undone.
 */

/** The libp2p node, once it exists. */
export const libp2pStore = writable(/** @type {any} */ (null));

/** This browser's peer id, once it has one. */
export const peerIdStore = writable(/** @type {string | null} */ (null));

/** @typedef {'pending' | 'active' | 'complete' | 'error'} InitializationStepStatus */
/** @typedef {{ key: string, status: InitializationStepStatus }} InitializationStep */

/** Progress of `initializeP2P`, read by the status nav. */
export const initializationStore = writable(
	/** @type {{ isInitializing: boolean, isInitialized: boolean, error: string | null, steps: InitializationStep[] }} */ ({
		isInitializing: false,
		isInitialized: false,
		error: null,
		steps: []
	})
);
