import { writable } from 'svelte/store';
import { findReachableRelays, readRelayOptIn } from '@le-space/libp2p-webrtc-qr';

// Everything else this file needs is imported inside the check, and the reason
// is not only lazy loading. `e2e/open-app.mjs` imports the storage key from
// here so no spec has to repeat the literal, and Playwright runs that under
// plain Node — where `libp2p-config.js` throws on `import.meta.env` at module
// scope. A static import would take the whole E2E suite down at collection
// time, which is how this was found.

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
 * component has mounted, so it cannot wait for `hydrateRelayOptIn`. The
 * reading itself — including what a blocked store means — comes from the
 * package, so this app and the element cannot disagree about what is stored
 * under the key they share.
 *
 * @returns {boolean}
 */
export function readStoredRelayOptIn() {
	return readRelayOptIn(
		typeof localStorage === 'undefined' ? null : localStorage,
		RELAY_OPT_IN_STORAGE_KEY
	);
}

/** Called once on mount: `localStorage` does not exist while prerendering. */
export function hydrateRelayOptIn() {
	relayOptIn.set(readStoredRelayOptIn());
}

/**
 * Wait until there is a node to ping from.
 *
 * The check needs a running libp2p, and a tick during startup would otherwise
 * report "no relay answered" when the truth is that nothing was asked yet —
 * the exact failure this check exists to remove. The dialog shows "looking…"
 * throughout, which is honest either way.
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<boolean>} whether a node arrived in time
 */
function whenNodeReady(/** @type {any} */ libp2pStore, timeoutMs = 15_000) {
	return new Promise((resolve) => {
		let done = false;
		const finish = (/** @type {boolean} */ value) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			unsubscribe();
			resolve(value);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		const unsubscribe = libp2pStore.subscribe((node) => {
			if (node) finish(true);
		});
	});
}

/**
 * Look for a relay this app can use, in the order that keeps its promise.
 *
 * Handed to `<qr-intro>` as its `relay.check`. The *rule* — shipped addresses
 * before any directory, and what a directory returns probed rather than
 * trusted — lives in the transport package, because it is the same decision in
 * every app built on it. What stays here is what only this app knows: which
 * addresses it shipped with, how it pings one, and which registrations on a
 * shared public channel are its own.
 *
 * The shape is written out rather than imported: `RelayCheck` is a JSDoc
 * typedef inside the package's `relay-choice.js` and is not re-exported from
 * its entry, so `import('…').RelayCheck` does not resolve. Worth exporting
 * upstream; not worth a release of its own.
 *
 * @returns {Promise<{ source: 'baked' | 'aleph' | 'none', addresses: string[], askedAleph: boolean }>}
 */
export async function checkRelayAvailability() {
	const [
		{ probeRelayAddresses },
		{ libp2pStore, pingMultiaddr, connectToMultiaddr },
		{ bakedRelayBootstrapAddrs },
		{ selectValidBrowserBootstrapMultiaddrs }
	] = await Promise.all([
		import('./relay-probe.js'),
		import('./p2p.js'),
		import('./libp2p-config.js'),
		import('./bootstrap-multiaddrs.js')
	]);

	if (!(await whenNodeReady(libp2pStore))) {
		return { source: 'none', addresses: [], askedAleph: false };
	}

	const result = await findReachableRelays({
		baked: bakedRelayBootstrapAddrs(),
		probe: (candidates) => probeRelayAddresses(candidates, { ping: pingMultiaddr }),
		// Imported inside the call, not at module scope: a start with the box
		// unticked must not even load the Aleph client, let alone call it.
		discover: async () => {
			const { discoverScopedBootstrapMultiaddrs } = await import('./aleph-bootstrap-discovery.js');
			// Scoped exactly as `ManualConnectForm` scopes it. The channel is public
			// and holds orphaned registrations of long-erased relays (#84); an
			// unscoped query would spend the probe budget on corpses.
			const discovered = await discoverScopedBootstrapMultiaddrs({
				profile: import.meta.env.VITE_RELAY_BOOTSTRAP_PROFILE || 'orbitdb-relay',
				registrationId:
					import.meta.env.VITE_RELAY_BOOTSTRAP_REGISTRATION_ID ||
					'relay:orbitdb-relay:orbitdb-relay'
			});
			return selectValidBrowserBootstrapMultiaddrs(discovered);
		}
	});

	// Finding one is not using one. The node was built without a relay in its
	// bootstrap list — that is what the unticked box buys — so the reservation
	// only happens if we dial now. The first reachable address is enough: they
	// come back in probe order, and one reservation is all a circuit needs.
	if (result.addresses.length > 0) {
		try {
			await connectToMultiaddr(result.addresses[0]);
		} catch {
			// The ping answered and the dial did not. Rare, and not worth a second
			// verdict line — the addresses stay listed as reachable.
		}
	}

	return result;
}
