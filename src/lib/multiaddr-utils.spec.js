import { describe, expect, it } from 'vitest';
import {
	normalizeDiscoveredMultiaddrs,
	relayHttpOriginForPeer,
	relayHttpOriginFromMultiaddr
} from './multiaddr-utils.js';

describe('normalizeDiscoveredMultiaddrs', () => {
	it('removes a duplicated terminal peer id from a relay circuit address', () => {
		const peerId = '12D3KooWRhJCkN3E4SqSYmCaDzfWjkZYNyKBhRmQZ7VgGWSeLRAA';
		const relayPeerId = '12D3KooWHMj4XZoj6b8ux25uvvgt32rK6h4zToLmBecXPPnYB66M';
		const address =
			`/ip4/127.0.0.1/tcp/49102/ws/p2p/${relayPeerId}` + `/p2p-circuit/p2p/${peerId}/p2p/${peerId}`;

		expect(normalizeDiscoveredMultiaddrs(peerId, [address])[0].toString()).toBe(
			`/ip4/127.0.0.1/tcp/49102/ws/p2p/${relayPeerId}/p2p-circuit/p2p/${peerId}`
		);
	});
});

describe('relayHttpOriginForPeer', () => {
	const relay = '12D3KooWE6Lqb1b9rNF9aFiuaFVLh5AJgeuWNGFT91oC9YYjfpas';
	const proxy = `/dns4/either-thing-fatal-true.2n6.me/tcp/443/tls/ws/p2p/${relay}`;
	const autotls = `/dns4/62-141-40-252.k51qzi.libp2p.direct/tcp/30410/tls/ws/p2p/${relay}`;

	it('finds the proxy address even when the browser arrived over AutoTLS', () => {
		// The regression this function exists for: reading the origin off the
		// live connection left an AutoTLS-connected browser with none, so it
		// logged "Waiting for a connected relay HTTP origin before proving"
		// until the run timed out.
		expect(relayHttpOriginForPeer(relay, [proxy, autotls], autotls)).toBe(
			'https://either-thing-fatal-true.2n6.me'
		);
	});

	it('ignores addresses belonging to a different peer', () => {
		const other = '12D3KooWHQiR9x27yqTrbdhMQNtWUegKNetzcQZZCRZ6mmQtyBxe';
		expect(relayHttpOriginForPeer(relay, [`/dns4/other.example/tcp/443/tls/ws/p2p/${other}`])).toBe(
			''
		);
	});

	it('falls back to the connection when nothing is known — local dev and e2e', () => {
		expect(relayHttpOriginForPeer(relay, [], proxy)).toBe('https://either-thing-fatal-true.2n6.me');
		expect(relayHttpOriginForPeer(relay, [], autotls)).toBe('');
		expect(relayHttpOriginForPeer('', [], '')).toBe('');
	});
});

describe('relayHttpOriginFromMultiaddr', () => {
	const relayPeerId = '12D3KooWE6Lqb1b9rNF9aFiuaFVLh5AJgeuWNGFT91oC9YYjfpas';

	it('uses the proxy hostname on 443, which fronts the HTTP API', () => {
		expect(
			relayHttpOriginFromMultiaddr(
				`/dns4/either-thing-fatal-true.2n6.me/tcp/443/tls/ws/p2p/${relayPeerId}`
			)
		).toBe('https://either-thing-fatal-true.2n6.me');
		expect(
			relayHttpOriginFromMultiaddr(
				`/dns6/either-thing-fatal-true.2n6.me/tcp/443/tls/ws/p2p/${relayPeerId}`
			)
		).toBe('https://either-thing-fatal-true.2n6.me');
	});

	it('refuses an AutoTLS address, whose port is the libp2p websocket listener', () => {
		// Verified against the live relay: this port answers
		// `400 Only WebSocket connections are supported` to any HTTP request,
		// with no CORS headers — which the browser then reports as a CORS error.
		expect(
			relayHttpOriginFromMultiaddr(
				'/dns4/62-141-40-252.k51qzi5uqu5dhrl6hltfa1r239dtwqv8sk10qay0ozxb7s0k46r0d4rm9f6rco.libp2p.direct/tcp/30410/tls/ws/p2p/' +
					relayPeerId
			)
		).toBe('');
	});

	it('refuses anything that is not a dns websocket address', () => {
		expect(relayHttpOriginFromMultiaddr(`/ip4/127.0.0.1/tcp/49102/ws/p2p/${relayPeerId}`)).toBe('');
		expect(relayHttpOriginFromMultiaddr('/dns4/example.com/tcp/443/quic-v1')).toBe('');
		expect(relayHttpOriginFromMultiaddr('')).toBe('');
		expect(relayHttpOriginFromMultiaddr(/** @type {any} */ (undefined))).toBe('');
	});
});
