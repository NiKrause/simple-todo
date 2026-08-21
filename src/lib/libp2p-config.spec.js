import { describe, expect, it } from 'vitest';

import {
	createLibp2pConfig,
	isInsecureWebSocketDial,
	selectRelayBootstrapAddrs
} from './libp2p-config.js';
import { rtcConfiguration } from './ice-mode.js';

const PEER = '/p2p/12D3KooWAX2ARgYnWjrAPHiM9hAXBvGUaQ9iK1PBNCV4FbMBRDVu';
const HTTPS = 'https:';
const HTTP = 'http:';

describe('isInsecureWebSocketDial', () => {
	it('denies plain ws dials on an https page (Chrome blocks them as mixed content)', () => {
		// The relay's internal ws port, announced via identify/pubsub — this is
		// the address family that filled the console with mixed-content errors.
		expect(isInsecureWebSocketDial(`/ip4/172.16.11.2/tcp/9092/ws${PEER}`, HTTPS)).toBe(true);
		expect(isInsecureWebSocketDial(`/ip6/2001:4ba0::1/tcp/9092/ws${PEER}`, HTTPS)).toBe(true);
		expect(isInsecureWebSocketDial(`/ip4/62.141.40.252/tcp/53380/ws${PEER}`, HTTPS)).toBe(true);
	});

	it('allows secure websocket forms on an https page', () => {
		// 2n6 proxy form
		expect(
			isInsecureWebSocketDial(`/dns4/present-spin-private-slot.2n6.me/tcp/443/tls/ws${PEER}`, HTTPS)
		).toBe(false);
		// AutoTLS SNI form — resolves to wss://<sni-host>:<port>
		expect(
			isInsecureWebSocketDial(
				`/ip4/62.141.40.252/tcp/53380/tls/sni/62-141-40-252.libp2p.direct/ws${PEER}`,
				HTTPS
			)
		).toBe(false);
		// Legacy /wss form
		expect(isInsecureWebSocketDial(`/dns4/example.com/tcp/4002/wss${PEER}`, HTTPS)).toBe(false);
	});

	it('leaves non-websocket transports untouched', () => {
		expect(isInsecureWebSocketDial(`/ip4/1.2.3.4/udp/4001/webrtc-direct${PEER}`, HTTPS)).toBe(
			false
		);
		expect(isInsecureWebSocketDial(`/ip4/1.2.3.4/tcp/4001${PEER}`, HTTPS)).toBe(false);
		expect(isInsecureWebSocketDial(`/p2p-circuit${PEER}`, HTTPS)).toBe(false);
	});

	it('allows plain ws on an http page so local dev and the E2E suite keep working', () => {
		expect(isInsecureWebSocketDial(`/ip4/127.0.0.1/tcp/49102/ws${PEER}`, HTTP)).toBe(false);
		expect(isInsecureWebSocketDial(`/ip4/172.16.11.2/tcp/9092/ws${PEER}`, HTTP)).toBe(false);
	});
});

describe('a chapter with no relay configured', () => {
	// The claim this chapter makes is that two devices meet by nothing but a
	// scanned code. That is only worth something if a relay is genuinely absent
	// rather than merely unused — a configured relay switches on discovery and
	// circuit reservations, and a green test could then be passing *through* one.
	//
	// It is equally important that the node stays *capable* of a relay, because
	// milestone 3 adds one and the two paths coexist. So this pins both halves:
	// nothing relay-shaped is configured, and the transports are still there.

	it('configures no bootstrap, no discovery and no circuit address', async () => {
		const config = await createLibp2pConfig();

		expect(config.services.bootstrap).toBeUndefined();
		expect(config.peerDiscovery).toEqual([]);
		expect(config.addresses.listen).not.toContain('/p2p-circuit');
	});

	it('still carries the transports a relay would need, so milestone 3 stays possible', async () => {
		const config = await createLibp2pConfig();

		// Foreclosing this is the one thing that would put M1 and M3 in conflict,
		// which is why yogasuci's `denyDialMultiaddr` gater is not copied here.
		expect(config.transports.length).toBeGreaterThan(1);
		expect(config.connectionGater.denyDialMultiaddr(`/p2p-circuit${PEER}`)).toBe(false);
	});

	it('gathers host candidates only, so no unreachable STUN delays the QR code', () => {
		// A payload carried by a human cannot trickle: the code is drawn only once
		// gathering completes, and unreachable STUN servers make that wait out the
		// full 15s timeout — once for the offer, again for the answer.
		expect(rtcConfiguration()).toEqual({ iceServers: [] });
	});
});

describe('selectRelayBootstrapAddrs', () => {
	// A build ships `VITE_RELAY_BOOTSTRAP_ADDR_PROD`, so without this rule the
	// node dialled that relay on every start and announced `/p2p-circuit` to it
	// — whatever the checkbox said. The promise is that an untouched start talks
	// to nobody, and it has to hold in the node, not only in the dialog.
	const BAKED = [`/dns4/relay.example/tcp/443/tls/ws${PEER}`];

	it('withholds a shipped relay until somebody asks for one', () => {
		expect(selectRelayBootstrapAddrs(BAKED, false)).toEqual([]);
	});

	it('hands over the shipped relay once they do', () => {
		expect(selectRelayBootstrapAddrs(BAKED, true)).toEqual(BAKED);
	});

	it('does not invent one when the build shipped none', () => {
		expect(selectRelayBootstrapAddrs([], true)).toEqual([]);
	});
});
