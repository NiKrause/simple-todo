import { describe, expect, it } from 'vitest';
import { normalizeDiscoveredMultiaddrs } from './multiaddr-utils.js';

describe('normalizeDiscoveredMultiaddrs', () => {
	it('removes a duplicated terminal peer id from a relay circuit address', () => {
		const peerId = '12D3KooWRhJCkN3E4SqSYmCaDzfWjkZYNyKBhRmQZ7VgGWSeLRAA';
		const relayPeerId = '12D3KooWHMj4XZoj6b8ux25uvvgt32rK6h4zToLmBecXPPnYB66M';
		const address =
			`/ip4/127.0.0.1/tcp/49102/ws/p2p/${relayPeerId}` +
			`/p2p-circuit/p2p/${peerId}/p2p/${peerId}`;

		expect(normalizeDiscoveredMultiaddrs(peerId, [address])[0].toString()).toBe(
			`/ip4/127.0.0.1/tcp/49102/ws/p2p/${relayPeerId}/p2p-circuit/p2p/${peerId}`
		);
	});
});
