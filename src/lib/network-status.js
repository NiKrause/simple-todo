import { writable } from 'svelte/store';

/**
 * How far the app reaches, in the simple view's terms (escrow01).
 *
 * The status panel works this out and lives in the network tab. The header
 * shows the same state as a small dot on every tab, so it reads it here
 * rather than working it out a second time.
 *
 * @typedef {'starting' | 'connecting' | 'relay' | 'direct' | 'failed'} NetworkState
 */

/** @type {import('svelte/store').Writable<NetworkState>} */
export const networkStateStore = writable('starting');
