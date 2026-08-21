import { writable } from 'svelte/store';

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
 * The stored choice, read without a store subscription.
 *
 * `libp2p-config` needs the answer while it builds the node, before any
 * component has mounted, so it cannot wait for `hydrateRelayOptIn`.
 *
 * @returns {boolean}
 */
export function readStoredRelayOptIn() {
	try {
		return localStorage.getItem(RELAY_OPT_IN_STORAGE_KEY) === 'true';
	} catch {
		// Storage blocked: off, which is the safe direction here.
		return false;
	}
}

/** Called once on mount: `localStorage` does not exist while prerendering. */
export function hydrateRelayOptIn() {
	relayOptIn.set(readStoredRelayOptIn());
}

export function setRelayOptIn(/** @type {boolean} */ next) {
	relayOptIn.set(next);
	try {
		localStorage.setItem(RELAY_OPT_IN_STORAGE_KEY, String(next));
	} catch {
		// The choice holds for this session only.
	}
}

/**
 * Find a relay that answers, cheapest source first.
 *
 * Baked-in addresses are probed before Aleph is asked, and that order is not
 * only about speed: it means the app talks to Aleph exactly when the addresses
 * it shipped with have gone quiet. Somebody who opens this in a studio where
 * the known relay is up never contacts a third party at all.
 *
 * Discovery is imported by the caller rather than here, so a caller that only
 * wants the baked-in check — or a test — never pulls the Aleph client in.
 *
 * @param {{
 *   baked?: readonly string[],
 *   probe: (addresses: string[]) => Promise<string[]>,
 *   discover?: () => Promise<string[]>
 * }} options
 * @returns {Promise<{ source: 'baked' | 'aleph' | 'none', addresses: string[], askedAleph: boolean }>}
 */
export async function findReachableRelays({ baked = [], probe, discover }) {
	const seed = [...baked].map((address) => address.trim()).filter(Boolean);

	if (seed.length > 0) {
		const reachable = await probe(seed);
		if (reachable.length > 0) {
			return { source: 'baked', addresses: reachable, askedAleph: false };
		}
	}

	if (!discover) {
		return { source: 'none', addresses: [], askedAleph: false };
	}

	// Only now, and only because nothing we shipped with answered.
	const discovered = await discover();
	const candidates = discovered.map((address) => address.trim()).filter(Boolean);
	if (candidates.length === 0) {
		return { source: 'none', addresses: [], askedAleph: true };
	}

	const reachable = await probe(candidates);
	return reachable.length > 0
		? { source: 'aleph', addresses: reachable, askedAleph: true }
		: { source: 'none', addresses: [], askedAleph: true };
}
