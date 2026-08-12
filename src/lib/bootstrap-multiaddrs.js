import { multiaddr } from '@multiformats/multiaddr';

/**
 * @param {string} address
 * @returns {string | null}
 */
export function extractPeerIdFromMultiaddr(address) {
	const parts = address.split('/').filter(Boolean);
	const peerIndex = parts.findIndex((part) => part === 'p2p' || part === 'ipfs');
	return peerIndex >= 0 ? parts[peerIndex + 1] || null : null;
}

/**
 * Can a browser dial this, and is it encrypted?
 *
 * The second half is the point, and it used to be missing. `/ws` was accepted
 * outright, which let a plain-text WebSocket address into a production build -
 * where an https page blocks it as mixed content and it can never connect. The
 * other two branches were dead anyway, since `/ws` is a substring of both
 * `/tls/ws` and `/wss`.
 *
 * A relay we run ourselves on localhost is the one honest exception: there is no
 * https origin to violate and no certificate to expect, so `allowInsecure` opens
 * exactly that door and nothing else. It is off unless a caller asks.
 *
 * What this cannot check is whether an address that *claims* TLS actually has
 * it. Our own relay currently announces `/tcp/52194/tls/sni/….libp2p.direct/ws`
 * for a port that answers plain-text `101 Switching Protocols` - so the string
 * passes here and fails on the wire. Only a probe catches that
 * (scripts/resolve-aleph-bootstrap.mjs), which is why the probe stays.
 *
 * @param {string} address
 * @param {{ allowInsecure?: boolean }} [options]
 * @returns {boolean}
 */
export function isBrowserDialableBootstrapMultiaddr(address, { allowInsecure = false } = {}) {
	const normalized = address.toLowerCase();

	// `/tls/` rather than `/tls/ws`: AutoTLS announces `/tls/sni/<host>/ws`, which
	// is the same guarantee written differently, and matching the narrow form
	// silently dropped it.
	if (normalized.includes('/tls/') || normalized.includes('/wss')) return true;
	if (normalized.includes('/webrtc-direct')) return true;
	if (!normalized.includes('/ws')) return false;

	// Plain WebSocket: only ours, only locally.
	return allowInsecure && isLoopbackMultiaddr(normalized);
}

/** @param {string} normalized a lower-cased multiaddr */
function isLoopbackMultiaddr(normalized) {
	return (
		normalized.startsWith('/ip4/127.') ||
		normalized.startsWith('/ip6/::1/') ||
		normalized.startsWith('/dns4/localhost/') ||
		normalized.startsWith('/dns6/localhost/') ||
		normalized.startsWith('/dns/localhost/')
	);
}

/**
 * @param {string} address
 * @returns {number}
 */
function rankBrowserBootstrapMultiaddr(address) {
	const normalized = address.toLowerCase();
	if (normalized.includes('/tcp/443/') && normalized.includes('/tls/ws')) return 0;
	if (normalized.includes('/tls/ws')) return 1;
	if (normalized.includes('/wss')) return 2;
	if (normalized.includes('/ip4/127.0.0.1/') && normalized.includes('/ws')) return 3;
	if (normalized.includes('/ws')) return 4;
	if (normalized.includes('/webrtc-direct')) return 5;
	return 10;
}

/**
 * Return unique, browser-dialable, parseable peer multiaddresses in preferred order.
 *
 * @param {readonly string[]} addresses
 * @returns {string[]}
 */
/**
 * @param {readonly string[]} addresses
 * @param {{ allowInsecure?: boolean }} [options] `allowInsecure` is for a relay
 *   started by a local dev or test run, never for a deployed build.
 */
export function selectValidBrowserBootstrapMultiaddrs(addresses, options = {}) {
	return [...new Set(addresses.map((address) => address.trim()).filter(Boolean))]
		.filter((address) => isBrowserDialableBootstrapMultiaddr(address, options))
		.filter((address) => {
			try {
				multiaddr(address);
				return extractPeerIdFromMultiaddr(address) != null;
			} catch {
				return false;
			}
		})
		.sort(
			(left, right) => rankBrowserBootstrapMultiaddr(left) - rankBrowserBootstrapMultiaddr(right)
		);
}

/**
 * @param {string | undefined | null} value
 * @returns {string[]}
 */
export function parseBootstrapMultiaddrs(value) {
	return typeof value === 'string'
		? value
				.split(',')
				.map((address) => address.trim())
				.filter(Boolean)
		: [];
}

/**
 * Resolve build-time addresses using explicit override, discovery, then fallback precedence.
 *
 * @param {{ override?: string | null, discovered?: readonly string[], fallback?: string | null }} options
 * @returns {{ addresses: string[], source: 'override' | 'aleph' | 'fallback' | 'none' }}
 */
/**
 * @param {{ override?: string, discovered?: readonly string[], fallback?: string,
 *   allowInsecure?: boolean }} [options] `allowInsecure` is passed straight to
 *   the selector - see isBrowserDialableBootstrapMultiaddr.
 */
export function resolveBootstrapMultiaddrs({
	override,
	discovered = [],
	fallback,
	allowInsecure = false
} = {}) {
	/** @type {Array<['override' | 'aleph' | 'fallback', string[]]>} */
	const candidates = [
		['override', parseBootstrapMultiaddrs(override)],
		['aleph', [...discovered]],
		['fallback', parseBootstrapMultiaddrs(fallback)]
	];

	for (const [source, addresses] of candidates) {
		const selected = selectValidBrowserBootstrapMultiaddrs(addresses, { allowInsecure });
		if (selected.length > 0) {
			return {
				addresses: selected,
				source
			};
		}
	}

	return { addresses: [], source: 'none' };
}

/**
 * @param {string} address
 * @returns {string}
 */
export function describeBootstrapMultiaddr(address) {
	const peerId = extractPeerIdFromMultiaddr(address);
	const host = address.match(/\/(?:dns4|dns6|ip4|ip6)\/([^/]+)/)?.[1] ?? 'relay';
	const transport = address.includes('/webrtc-direct') ? 'WebRTC Direct' : 'WebSocket';
	const shortPeerId = peerId ? `${peerId.slice(0, 8)}…${peerId.slice(-6)}` : 'unknown peer';
	return `${host} · ${transport} · ${shortPeerId}`;
}
