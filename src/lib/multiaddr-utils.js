import { multiaddr } from '@multiformats/multiaddr';

/**
 * The relay's HTTP API origin, derived from a connection's multiaddr — or ''
 * when this address does not front one.
 *
 * Only a proxy on 443 does. The relay's HTTP API is served by Caddy on the 2n6
 * hostname, which terminates TLS on 443 and both proxies the WebSocket upgrade
 * and answers `/health`, `/pinning/*`. Reusing the host is right; reusing the
 * port is not.
 *
 * An AutoTLS address carries the libp2p WebSocket listener's own port
 * (`/dns4/62-141-40-252.<key>.libp2p.direct/tcp/30410/tls/ws/…`), and that
 * listener speaks nothing else:
 *
 *   GET https://…libp2p.direct:30410/health
 *   → 400 Bad Request  "Only WebSocket connections are supported"
 *
 * A 400 with no CORS headers on it is reported by the browser as a CORS
 * violation ("No 'Access-Control-Allow-Origin' header is present"), which is
 * how this read for a long time as a relay misconfiguration. It is not — the
 * proxy origin answers 200 with `access-control-allow-origin: *`. We were
 * asking the wrong port.
 *
 * Whether a browser holds the proxy address or the AutoTLS one varies per run,
 * so this decided at random whether the pinning proof could work at all.
 * Returning '' is the honest answer for an address that cannot serve HTTP:
 * callers already treat a missing origin as "nobody has been asked yet" and
 * leave the proof indeterminate, instead of firing requests that cannot
 * succeed.
 *
 * @param {string} address a multiaddr string
 * @returns {string} an https origin, or '' if this address fronts no HTTP API
 */
export function relayHttpOriginFromMultiaddr(address) {
	const match = String(address ?? '').match(
		/\/dns[46]\/([^/]+)\/tcp\/(\d+)\/(?:tls\/)?(?:ws|wss)(?:\/|$)/i
	);
	if (!match || match[2] !== '443') return '';
	return `https://${match[1]}`;
}

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
