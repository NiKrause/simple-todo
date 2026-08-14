import { describe, it, expect } from 'vitest';
import {
	groupAddressesByPeer,
	isStreamLimitError,
	peerIdFromMultiaddr,
	probeRelayAddresses
} from './relay-probe.js';

const PEER_A = '12D3KooWNkdvDw59Agjuhk6a3LTeqnsBgV4m5eivVjXdcgC7cYhn';
const PEER_B = '12D3KooWFaGcgD44tpxYovxGLqpTnM38moEz8R1mN2NaNy4G5Qvx';

// The four addresses passkey01's failing run actually had to choose between.
const A_DIRECT = `/dns4/62-141-40-252.k51qzi5.libp2p.direct/tcp/62227/tls/ws/p2p/${PEER_A}`;
const A_2N6_V4 = `/dns4/method-mask-alcohol-conduct.2n6.me/tcp/443/tls/ws/p2p/${PEER_A}`;
const A_2N6_V6 = `/dns6/method-mask-alcohol-conduct.2n6.me/tcp/443/tls/ws/p2p/${PEER_A}`;
const B_2N6_V4 = `/dns4/vintage-milk-weapon-stick.2n6.me/tcp/443/tls/ws/p2p/${PEER_B}`;

function streamLimitError() {
	const error = new Error(
		'Too many outbound protocol streams for protocol "/ipfs/ping/1.0.0" - 2/1'
	);
	error.name = 'TooManyOutboundProtocolStreamsError';
	return error;
}

describe('peerIdFromMultiaddr', () => {
	it('reads /p2p/ and /ipfs/', () => {
		expect(peerIdFromMultiaddr(A_DIRECT)).toBe(PEER_A);
		expect(peerIdFromMultiaddr(`/dns4/x/tcp/443/ipfs/${PEER_B}`)).toBe(PEER_B);
	});

	it('returns null when there is no peer component', () => {
		expect(peerIdFromMultiaddr('/dns4/x/tcp/443/tls/ws')).toBe(null);
		expect(peerIdFromMultiaddr('')).toBe(null);
	});
});

describe('isStreamLimitError', () => {
	it('recognises the error by name, code or message', () => {
		expect(isStreamLimitError(streamLimitError())).toBe(true);
		expect(isStreamLimitError({ code: 'ERR_TOO_MANY_OUTBOUND_PROTOCOL_STREAMS' })).toBe(true);
		expect(isStreamLimitError(new Error('Too many outbound protocol streams - 2/1'))).toBe(true);
	});

	it('does not swallow real failures', () => {
		expect(isStreamLimitError(new Error('connection refused'))).toBe(false);
		expect(isStreamLimitError(new Error('The dial request has no valid addresses'))).toBe(false);
		expect(isStreamLimitError(null)).toBe(false);
		expect(isStreamLimitError(undefined)).toBe(false);
	});
});

describe('groupAddressesByPeer', () => {
	it('puts one peer’s addresses in one group', () => {
		expect(groupAddressesByPeer([A_DIRECT, B_2N6_V4, A_2N6_V4, A_2N6_V6])).toEqual([
			[A_DIRECT, A_2N6_V4, A_2N6_V6],
			[B_2N6_V4]
		]);
	});

	it('keeps peerless addresses independent so they stay parallel', () => {
		const bare1 = '/dns4/a/tcp/443/tls/ws';
		const bare2 = '/dns4/b/tcp/443/tls/ws';
		expect(groupAddressesByPeer([bare1, bare2])).toEqual([[bare1], [bare2]]);
	});
});

describe('probeRelayAddresses', () => {
	it('never runs two pings for the same peer at once', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		const reachable = await probeRelayAddresses([A_DIRECT, A_2N6_V4, A_2N6_V6], {
			ping: async () => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await Promise.resolve();
				inFlight--;
			}
		});
		expect(maxInFlight).toBe(1);
		expect(reachable).toEqual([A_DIRECT, A_2N6_V4, A_2N6_V6]);
	});

	it('probes different peers concurrently', async () => {
		let inFlight = 0;
		let maxInFlight = 0;
		/** @type {(value?: unknown) => void} */
		let release = () => {};
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		const probe = probeRelayAddresses([A_DIRECT, B_2N6_V4], {
			ping: async () => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				await gate;
				inFlight--;
			}
		});
		await Promise.resolve();
		release();
		await probe;
		expect(maxInFlight).toBe(2);
	});

	it('keeps an address that only hit the stream cap', async () => {
		// The regression: this error means the connection is up, so dropping the
		// address threw away a working relay.
		/** @type {string[]} */
		const unreachable = [];
		const reachable = await probeRelayAddresses([A_DIRECT, A_2N6_V4], {
			ping: async (address) => {
				if (address === A_2N6_V4) throw streamLimitError();
			},
			onUnreachable: (address) => unreachable.push(address)
		});
		expect(reachable).toEqual([A_DIRECT, A_2N6_V4]);
		expect(unreachable).toEqual([]);
	});

	it('still drops genuinely unreachable addresses', async () => {
		/** @type {string[]} */
		const unreachable = [];
		const reachable = await probeRelayAddresses([A_DIRECT, A_2N6_V4], {
			ping: async (address) => {
				if (address === A_2N6_V4) throw new Error('connection refused');
			},
			onUnreachable: (address) => unreachable.push(address)
		});
		expect(reachable).toEqual([A_DIRECT]);
		expect(unreachable).toEqual([A_2N6_V4]);
	});

	it('does not lose a relay when every address of it hits the cap', async () => {
		// passkey01 run 31717535131 in one assertion: both addresses of the only
		// relay were discarded and the app was left with nothing to dial.
		const reachable = await probeRelayAddresses([A_DIRECT, A_2N6_V4], {
			ping: async () => {
				throw streamLimitError();
			}
		});
		expect(reachable).toEqual([A_DIRECT, A_2N6_V4]);
	});

	it('returns results in the input order', async () => {
		const reachable = await probeRelayAddresses([B_2N6_V4, A_DIRECT, A_2N6_V4], {
			ping: async () => {}
		});
		expect(reachable).toEqual([B_2N6_V4, A_DIRECT, A_2N6_V4]);
	});

	it('returns an empty list when nothing answers', async () => {
		const reachable = await probeRelayAddresses([A_DIRECT], {
			ping: async () => {
				throw new Error('timeout');
			}
		});
		expect(reachable).toEqual([]);
	});
});
