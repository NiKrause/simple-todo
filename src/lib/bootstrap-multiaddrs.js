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
 * @param {string} address
 * @returns {boolean}
 */
export function isBrowserDialableBootstrapMultiaddr(address) {
	const normalized = address.toLowerCase();
	return (
		normalized.includes('/tls/ws') ||
		normalized.includes('/ws') ||
		normalized.includes('/wss') ||
		normalized.includes('/webrtc-direct')
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
export function selectValidBrowserBootstrapMultiaddrs(addresses) {
	return [...new Set(addresses.map((address) => address.trim()).filter(Boolean))]
		.filter(isBrowserDialableBootstrapMultiaddr)
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
export function resolveBootstrapMultiaddrs({ override, discovered = [], fallback } = {}) {
	/** @type {Array<['override' | 'aleph' | 'fallback', string[]]>} */
	const candidates = [
		['override', parseBootstrapMultiaddrs(override)],
		['aleph', [...discovered]],
		['fallback', parseBootstrapMultiaddrs(fallback)]
	];

	for (const [source, addresses] of candidates) {
		const selected = selectValidBrowserBootstrapMultiaddrs(addresses);
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
