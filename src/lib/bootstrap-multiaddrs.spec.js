import { describe, expect, it } from 'vitest';
import {
	describeBootstrapMultiaddr,
	isBrowserDialableBootstrapMultiaddr,
	resolveBootstrapMultiaddrs,
	selectValidBrowserBootstrapMultiaddrs
} from './bootstrap-multiaddrs.js';

const peerA = '12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE';
const peerB = '12D3KooWSc3Sqr3Q7RGJAFBz5i7WTTC5kzunnm2tvXVcSwTEtUTP';
const secureAddress = `/dns4/relay.example/tcp/443/tls/ws/p2p/${peerA}`;
// Loopback and plain text: the shape a locally started relay has. Since
// encryption became a requirement it only qualifies with `allowInsecure`, which
// is what a dev or e2e run passes - so the tests below pass it too.
const websocketAddress = `/ip4/127.0.0.1/tcp/4001/ws/p2p/${peerB}`;
const localRelay = { allowInsecure: true };

describe('bootstrap multiaddress selection', () => {
	it('filters invalid and non-browser addresses, deduplicates, and ranks secure WebSockets first', () => {
		expect(
			selectValidBrowserBootstrapMultiaddrs(
				[
					websocketAddress,
					'/ip4/203.0.113.1/tcp/4001',
					secureAddress,
					secureAddress,
					'/not/a/multiaddr'
				],
				localRelay
			)
		).toEqual([secureAddress, websocketAddress]);
	});

	it('uses override, Aleph discovery, then fallback precedence', () => {
		expect(
			resolveBootstrapMultiaddrs({
				override: secureAddress,
				discovered: [websocketAddress],
				fallback: websocketAddress,
				...localRelay
			})
		).toEqual({ addresses: [secureAddress], source: 'override' });

		expect(
			resolveBootstrapMultiaddrs({
				discovered: [websocketAddress],
				fallback: secureAddress,
				...localRelay
			})
		).toEqual({ addresses: [websocketAddress], source: 'aleph' });

		expect(resolveBootstrapMultiaddrs({ fallback: secureAddress })).toEqual({
			addresses: [secureAddress],
			source: 'fallback'
		});
	});

	it('reports an empty resolution when every source is unusable', () => {
		expect(
			resolveBootstrapMultiaddrs({
				override: '/ip4/203.0.113.1/tcp/4001',
				discovered: [],
				fallback: ''
			})
		).toEqual({ addresses: [], source: 'none' });
	});

	it('creates a readable selector label', () => {
		expect(describeBootstrapMultiaddr(secureAddress)).toContain('relay.example · WebSocket');
	});
});

describe('encryption is required unless we started the relay ourselves', () => {
	const PEER = '/p2p/12D3KooWFWtuGWLQmD9FsM1vW7VfBTEQST8QgzoQeBpQDr13pExF';

	// Both shapes our own relay announces, and both are legitimate strings: Caddy
	// terminates TLS on 443, AutoTLS uses the /tls/sni/<host>/ws form. Whether the
	// port behind them really speaks TLS is not something a string can answer -
	// that is what the probe in scripts/resolve-aleph-bootstrap.mjs is for.
	it('accepts encrypted addresses in every shape', () => {
		for (const address of [
			`/dns4/what-kit-mansion-output.2n6.me/tcp/443/tls/ws${PEER}`,
			`/dns4/62-141-40-252.k51qzi.libp2p.direct/tcp/52194/tls/ws${PEER}`,
			`/ip4/62.141.40.252/tcp/52194/tls/sni/62-141-40-252.k51qzi.libp2p.direct/ws${PEER}`,
			`/ip4/62.141.40.252/udp/52191/webrtc-direct${PEER}`
		]) {
			expect(isBrowserDialableBootstrapMultiaddr(address)).toBe(true);
		}
	});

	// The one this exists for. A public plain-text WebSocket address reached a
	// production build once; on an https page the browser blocks it as mixed
	// content, so it could never have worked.
	it('rejects a public plain-text websocket address, even in dev', () => {
		const address = `/ip4/62.141.40.252/tcp/52194/ws${PEER}`;

		expect(isBrowserDialableBootstrapMultiaddr(address)).toBe(false);
		expect(isBrowserDialableBootstrapMultiaddr(address, { allowInsecure: true })).toBe(false);
	});

	it('allows a plain-text relay on loopback, and only when asked', () => {
		for (const address of [
			`/ip4/127.0.0.1/tcp/9092/ws${PEER}`,
			`/dns4/localhost/tcp/9092/ws${PEER}`
		]) {
			expect(isBrowserDialableBootstrapMultiaddr(address)).toBe(false);
			expect(isBrowserDialableBootstrapMultiaddr(address, { allowInsecure: true })).toBe(true);
		}
	});

	it('does not let allowInsecure through the selector by default', () => {
		const insecure = `/ip4/127.0.0.1/tcp/9092/ws${PEER}`;

		expect(selectValidBrowserBootstrapMultiaddrs([insecure])).toEqual([]);
		expect(selectValidBrowserBootstrapMultiaddrs([insecure], { allowInsecure: true })).toEqual([
			insecure
		]);
	});
});
