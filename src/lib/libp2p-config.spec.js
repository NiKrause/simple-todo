import { describe, expect, it } from 'vitest';

import { isInsecureWebSocketDial } from './libp2p-config.js';

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
		expect(isInsecureWebSocketDial(`/ip4/1.2.3.4/udp/4001/webrtc-direct${PEER}`, HTTPS)).toBe(false);
		expect(isInsecureWebSocketDial(`/ip4/1.2.3.4/tcp/4001${PEER}`, HTTPS)).toBe(false);
		expect(isInsecureWebSocketDial(`/p2p-circuit${PEER}`, HTTPS)).toBe(false);
	});

	it('allows plain ws on an http page so local dev and the E2E suite keep working', () => {
		expect(isInsecureWebSocketDial(`/ip4/127.0.0.1/tcp/49102/ws${PEER}`, HTTP)).toBe(false);
		expect(isInsecureWebSocketDial(`/ip4/172.16.11.2/tcp/9092/ws${PEER}`, HTTP)).toBe(false);
	});
});
