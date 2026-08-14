// Probing which discovered relay addresses a browser can actually reach.
//
// The probe used to be one `Promise.all` over every candidate. That looks
// harmless until you notice what the candidates are: several addresses of the
// *same* relay — `…libp2p.direct` and `…2n6.me`, each as dns4 and dns6, all
// carrying the same peer id. libp2p muxes those onto one connection, and the
// ping service allows a single outbound `/ipfs/ping/1.0.0` stream, so the
// second concurrent ping fails with TooManyOutboundProtocolStreamsError. The
// old catch-all logged that address as unreachable and dropped it — and when
// the race went badly it dropped every address of the only working relay,
// leaving the app with no relay at all. passkey01's remote-replication run
// 31717535131 failed exactly that way.
//
// Two things follow, and both are fixed here rather than by raising the stream
// limit: pinging one peer over several addresses at once proves nothing extra,
// and that particular error is evidence *for* reachability — it cannot happen
// without a live connection to the peer.

/**
 * Peer id carried by a multiaddr, or null when it has none.
 *
 * @param {string} address
 * @returns {string | null}
 */
export function peerIdFromMultiaddr(address) {
	const parts = String(address).split('/').filter(Boolean);
	const index = parts.findIndex((part) => part === 'p2p' || part === 'ipfs');
	return index >= 0 ? parts[index + 1] || null : null;
}

/**
 * True when this failure only proves the connection is alive.
 *
 * libp2p reports the stream cap as a `code` of
 * `ERR_TOO_MANY_OUTBOUND_PROTOCOL_STREAMS` and a name of
 * `TooManyOutboundProtocolStreamsError`; the message is matched too, since the
 * shape has moved between versions and a false negative here costs a relay.
 *
 * @param {any} error
 * @returns {boolean}
 */
export function isStreamLimitError(error) {
	if (!error) return false;
	const fields = [error.code, error.name, error.message].filter(
		(value) => typeof value === 'string'
	);
	return fields.some((value) => /too.?many.?outbound.?protocol.?streams/i.test(value));
}

/**
 * Group candidates by peer, preserving order.
 *
 * Addresses without a peer id each get their own group: nothing says two of
 * them share a connection, so serializing them would only slow the probe down.
 *
 * @param {string[]} addresses
 * @returns {string[][]}
 */
export function groupAddressesByPeer(addresses) {
	/** @type {Map<string, string[]>} */
	const byPeer = new Map();
	/** @type {string[][]} */
	const ungrouped = [];

	for (const address of addresses) {
		const peerId = peerIdFromMultiaddr(address);
		if (!peerId) {
			ungrouped.push([address]);
			continue;
		}
		const existing = byPeer.get(peerId);
		if (existing) existing.push(address);
		else byPeer.set(peerId, [address]);
	}

	return [...byPeer.values(), ...ungrouped];
}

/**
 * Ping every candidate and return those that answered.
 *
 * Peers are probed concurrently, at most `groupConcurrency` at a time; the
 * addresses *within* one peer are probed one after another, which is what stops
 * a relay from knocking out its own candidates. `onReachable` fires as each
 * address answers so a caller can surface relays progressively instead of
 * waiting for the whole wave.
 *
 * @param {string[]} candidates
 * @param {{
 *   ping: (address: string) => Promise<unknown>,
 *   onReachable?: (address: string) => void,
 *   onUnreachable?: (address: string, error: unknown) => void,
 *   groupConcurrency?: number
 * }} options
 * @returns {Promise<string[]>} reachable addresses, in the input order
 */
export async function probeRelayAddresses(
	candidates,
	{ ping, onReachable, onUnreachable, groupConcurrency = 4 }
) {
	const groups = groupAddressesByPeer(candidates);
	/** @type {Set<string>} */
	const reachable = new Set();
	const limit = Math.max(1, groupConcurrency);

	const probeGroup = async (/** @type {string[]} */ group) => {
		for (const address of group) {
			try {
				await ping(address);
			} catch (error) {
				if (!isStreamLimitError(error)) {
					onUnreachable?.(address, error);
					continue;
				}
				// Only a reachable address can hit the stream cap.
			}
			reachable.add(address);
			onReachable?.(address);
		}
	};

	for (let index = 0; index < groups.length; index += limit) {
		await Promise.all(groups.slice(index, index + limit).map(probeGroup));
	}

	return candidates.filter((address) => reachable.has(address));
}
