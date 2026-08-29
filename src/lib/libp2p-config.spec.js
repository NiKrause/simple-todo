import { describe, expect, it } from 'vitest';

import { IDENTIFY_MAX_MESSAGE_SIZE, isInsecureWebSocketDial } from './libp2p-config.js';
// The module's own text: the ceiling is passed into a factory and closed over,
// so which call sites carry it cannot be read back off the built config.
import source from './libp2p-config.js?raw';

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

describe('the identify size ceiling', () => {
	// Not round numbers picked for comfort - what the production relay actually
	// measured. The point is that the constant stays above them as they grow.
	const LIBP2P_DEFAULT = 8192;
	const MEASURED_WORST = 10538;

	it('is above the default that made clients drop the relay', () => {
		expect(IDENTIFY_MAX_MESSAGE_SIZE).toBeGreaterThan(LIBP2P_DEFAULT);
	});

	it('is above the largest response the relay was measured at', () => {
		// A ceiling under this has already been crossed once in production.
		expect(IDENTIFY_MAX_MESSAGE_SIZE).toBeGreaterThan(MEASURED_WORST);
	});

	it('leaves room for the part that grows', () => {
		// One protocol per open database, and the relay went from 122 to 129 of
		// them within an hour. Roughly 700 databases of headroom.
		expect(IDENTIFY_MAX_MESSAGE_SIZE).toBeGreaterThanOrEqual(MEASURED_WORST * 6);
	});

	it('is given to every identify service, not just the first one', () => {
		// The failure this catches happened: `identify` was raised and
		// `identifyPush` was left on the default, so the first answer from a
		// large peer came through and every later update from it was dropped
		// whole. Reading the source, because the option disappears into a
		// closure and cannot be read back off the built config.
		const calls = source.match(/identify(?:Push)?\([^)]*\)/g) ?? [];

		expect(calls.length).toBeGreaterThan(0);

		for (const call of calls) {
			expect(call, `${call} does not carry the ceiling`).toContain('IDENTIFY_MAX_MESSAGE_SIZE');
		}
	});
});
