import { multiaddr } from '@multiformats/multiaddr';

/**
 * Normalize discovered addresses and ensure the discovered peer id occurs once
 * at the end. Some relay discovery paths already include the target peer id.
 *
 * @param {string} discoveredPeerId
 * @param {unknown[]} multiaddrs
 * @returns {any[]}
 */
export function normalizeDiscoveredMultiaddrs(discoveredPeerId, multiaddrs) {
	const peerSuffix = `/p2p/${discoveredPeerId}`;

	return multiaddrs
		.map((addr) => {
			try {
				const parsed = typeof addr === 'string' ? multiaddr(addr) : /** @type {any} */ (addr);
				let addrString = parsed.toString();

				while (addrString.endsWith(`${peerSuffix}${peerSuffix}`)) {
					addrString = addrString.slice(0, -peerSuffix.length);
				}

				const normalized = /** @type {any} */ (multiaddr(addrString));
				const components = normalized.getComponents?.() ?? [];
				if (components.at(-1)?.name === 'p2p') {
					return normalized;
				}

				if (!addrString.startsWith('/')) {
					return null;
				}

				return multiaddr(`${addrString}${peerSuffix}`);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}
