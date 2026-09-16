/**
 * Format PeerId for display - shows first 5 characters for better readability
 * @param {string} peerId - Full peer ID string
 * @returns {string} Formatted peer ID
 */
export function formatPeerId(peerId) {
	if (!peerId || typeof peerId !== 'string') {
		return 'unknown';
	}
	// Show first 4 and last 4 characters for better readability
	// const start = peerId.slice(0, 4)
	const end = peerId.slice(-4);
	// return `${start}...${end}`
	return `${end}`;
}

/**
 * Shorten an identifier for display: an Ethereum address or a 32-byte hash to
 * `0x5b1e…d4a2`, anything else long (a DID) to its first 14 and last 6
 * characters. The whole value belongs in a `title` beside it.
 *
 * @param {string | null | undefined} value
 * @returns {string}
 */
export function shortId(value) {
	if (!value) return '';
	if (/^0x[0-9a-fA-F]{40,}$/.test(value)) return `${value.slice(0, 6)}…${value.slice(-4)}`;
	return value.length > 24 ? `${value.slice(0, 14)}…${value.slice(-6)}` : value;
}
