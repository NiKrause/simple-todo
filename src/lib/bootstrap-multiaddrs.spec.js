import { describe, expect, it } from 'vitest';
import {
	describeBootstrapMultiaddr,
	resolveBootstrapMultiaddrs,
	selectValidBrowserBootstrapMultiaddrs
} from './bootstrap-multiaddrs.js';

const peerA = '12D3KooWAJjbRkp8FPF5MKgMU53aUTxWkqvDrs4zc1VMbwRwfsbE';
const peerB = '12D3KooWSc3Sqr3Q7RGJAFBz5i7WTTC5kzunnm2tvXVcSwTEtUTP';
const secureAddress = `/dns4/relay.example/tcp/443/tls/ws/p2p/${peerA}`;
const websocketAddress = `/ip4/127.0.0.1/tcp/4001/ws/p2p/${peerB}`;

describe('bootstrap multiaddress selection', () => {
	it('filters invalid and non-browser addresses, deduplicates, and ranks secure WebSockets first', () => {
		expect(
			selectValidBrowserBootstrapMultiaddrs([
				websocketAddress,
				'/ip4/203.0.113.1/tcp/4001',
				secureAddress,
				secureAddress,
				'/not/a/multiaddr'
			])
		).toEqual([secureAddress, websocketAddress]);
	});

	it('uses override, Aleph discovery, then fallback precedence', () => {
		expect(
			resolveBootstrapMultiaddrs({
				override: secureAddress,
				discovered: [websocketAddress],
				fallback: websocketAddress
			})
		).toEqual({ addresses: [secureAddress], source: 'override' });

		expect(
			resolveBootstrapMultiaddrs({ discovered: [websocketAddress], fallback: secureAddress })
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
