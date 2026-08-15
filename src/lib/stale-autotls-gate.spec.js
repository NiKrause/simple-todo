import { describe, it, expect } from 'vitest';
import {
	createStaleAutoTlsGate,
	embeddedHostAddress,
	isIpDerivedAutoTlsAddress
} from './stale-autotls-gate.js';

const PEER = '12D3KooWNkdvDw59Agjuhk6a3LTeqnsBgV4m5eivVjXdcgC7cYhn';
const OTHER_PEER = '12D3KooWFaGcgD44tpxYovxGLqpTnM38moEz8R1mN2NaNy4G5Qvx';
const KEY = 'k51qzi5uqu5dkz1kmvrj16xwmxnydfxk7zykys7mfssefwzqtmqnzvtnw5lms1';

// The exact records from issue #154.
const PROXY = `/dns4/method-mask-alcohol-conduct.2n6.me/tcp/443/tls/ws/p2p/${PEER}`;
const PROXY_V6 = `/dns6/method-mask-alcohol-conduct.2n6.me/tcp/443/tls/ws/p2p/${PEER}`;
const STALE = `/dns4/62-141-40-252.${KEY}.libp2p.direct/tcp/62227/tls/ws/p2p/${PEER}`;
const VERIFIED_AUTOTLS = `/dns4/193-111-199-84.${KEY}.libp2p.direct/tcp/24011/tls/ws/p2p/${OTHER_PEER}`;

describe('isIpDerivedAutoTlsAddress', () => {
	it('recognises the v4 and v6 forms', () => {
		expect(isIpDerivedAutoTlsAddress(STALE)).toBe(true);
		expect(
			isIpDerivedAutoTlsAddress(
				`/dns6/2001-4ba0-ffe7-52-3-f431-93e1-6ad1.${KEY}.libp2p.direct/tcp/9092/tls/ws/p2p/${PEER}`
			)
		).toBe(true);
	});

	it('leaves everything else alone', () => {
		expect(isIpDerivedAutoTlsAddress(PROXY)).toBe(false);
		expect(isIpDerivedAutoTlsAddress(PROXY_V6)).toBe(false);
		expect(isIpDerivedAutoTlsAddress(`/ip4/1.2.3.4/tcp/4001/ws/p2p/${PEER}`)).toBe(false);
		expect(isIpDerivedAutoTlsAddress(`/p2p/${PEER}/p2p-circuit/p2p/${OTHER_PEER}`)).toBe(false);
		// A libp2p.direct name whose first label is not a dashed address.
		expect(
			isIpDerivedAutoTlsAddress(`/dns4/relay.${KEY}.libp2p.direct/tcp/443/tls/ws/p2p/${PEER}`)
		).toBe(false);
	});
});

describe('embeddedHostAddress', () => {
	it('reads the host out of the name', () => {
		expect(embeddedHostAddress(STALE)).toBe('62.141.40.252');
		expect(
			embeddedHostAddress(
				`/dns6/2001-4ba0-ffe7-52-3-f431-93e1-6ad1.${KEY}.libp2p.direct/tcp/9092/tls/ws/p2p/${PEER}`
			)
		).toBe('2001:4ba0:ffe7:52:3:f431:93e1:6ad1');
	});

	it('is null for anything not IP-derived', () => {
		expect(embeddedHostAddress(PROXY)).toBe(null);
	});
});

describe('createStaleAutoTlsGate', () => {
	it('refuses the stale AutoTLS address of a relay we have verified', () => {
		// #154 in one assertion: the proxy addresses verified, the AutoTLS one
		// not, and the browser learns the latter through identify.
		/** @type {Array<{ address: string, peerId: string, host: string | null }>} */
		const denied = [];
		const gate = createStaleAutoTlsGate([PROXY, PROXY_V6], {
			onDeny: (info) => denied.push(info)
		});
		expect(gate(STALE)).toBe(true);
		expect(denied).toEqual([{ address: STALE, peerId: PEER, host: '62.141.40.252' }]);
	});

	it('allows the addresses that were verified', () => {
		const gate = createStaleAutoTlsGate([PROXY, PROXY_V6, VERIFIED_AUTOTLS]);
		expect(gate(PROXY)).toBe(false);
		expect(gate(PROXY_V6)).toBe(false);
		// AutoTLS is not banned as a family — this one answered at build time.
		expect(gate(VERIFIED_AUTOTLS)).toBe(false);
	});

	it('does not judge a relay it has no snapshot for', () => {
		// Only bootstrap peers we verified are in scope; a stranger's AutoTLS
		// address may well be current, and refusing it would break first contact.
		const gate = createStaleAutoTlsGate([PROXY]);
		const strangerAutoTls = `/dns4/9-9-9-9.${KEY}.libp2p.direct/tcp/443/tls/ws/p2p/${OTHER_PEER}`;
		expect(gate(strangerAutoTls)).toBe(false);
	});

	it('leaves every other transport untouched', () => {
		const gate = createStaleAutoTlsGate([PROXY]);
		expect(gate(`/ip4/1.2.3.4/tcp/4001/ws/p2p/${PEER}`)).toBe(false);
		expect(gate(`/dns4/method-mask-alcohol-conduct.2n6.me/tcp/443/tls/ws/p2p/${PEER}`)).toBe(false);
		expect(gate(`/p2p/${PEER}/p2p-circuit/p2p/${OTHER_PEER}`)).toBe(false);
		expect(gate(`/ip4/1.2.3.4/udp/4001/webrtc-direct/certhash/uEi/p2p/${PEER}`)).toBe(false);
	});

	it('ignores an address with no peer id rather than guessing whose it is', () => {
		const gate = createStaleAutoTlsGate([PROXY]);
		expect(gate(`/dns4/62-141-40-252.${KEY}.libp2p.direct/tcp/62227/tls/ws`)).toBe(false);
	});

	it('is inert without a verified set', () => {
		expect(createStaleAutoTlsGate([])(STALE)).toBe(false);
		expect(createStaleAutoTlsGate(/** @type {any} */ (undefined))(STALE)).toBe(false);
	});

	it('accepts multiaddr objects, not just strings', () => {
		const gate = createStaleAutoTlsGate([PROXY]);
		expect(gate({ toString: () => STALE })).toBe(true);
	});
});
