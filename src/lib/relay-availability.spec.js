import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	RELAY_OPT_IN_STORAGE_KEY,
	findReachableRelays,
	readStoredRelayOptIn,
	setRelayOptIn
} from './relay-availability.js';

const BAKED = ['/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWBaked'];
const FOUND = ['/dns4/found.example/tcp/443/tls/ws/p2p/12D3KooWFound'];

describe('findReachableRelays', () => {
	it('never asks Aleph when a baked-in relay answers', async () => {
		const discover = vi.fn();
		const result = await findReachableRelays({
			baked: BAKED,
			probe: async (addresses) => addresses,
			discover
		});

		expect(result).toEqual({ source: 'baked', addresses: BAKED, askedAleph: false });
		// The whole point of the order: a working known relay means no third
		// party learns this device opened the app.
		expect(discover).not.toHaveBeenCalled();
	});

	it('falls back to discovery only once the baked-in ones are silent', async () => {
		const discover = vi.fn(async () => FOUND);
		const result = await findReachableRelays({
			baked: BAKED,
			probe: async (addresses) => (addresses[0] === BAKED[0] ? [] : addresses),
			discover
		});

		expect(discover).toHaveBeenCalledOnce();
		expect(result).toEqual({ source: 'aleph', addresses: FOUND, askedAleph: true });
	});

	it('probes what discovery returned rather than trusting it', async () => {
		// A registration can outlive its VM: the Aleph channel is public and
		// orphaned records are never forgotten, so "discovered" is not "alive".
		const result = await findReachableRelays({
			baked: [],
			probe: async () => [],
			discover: async () => FOUND
		});

		expect(result).toEqual({ source: 'none', addresses: [], askedAleph: true });
	});

	it('reports none without asking Aleph when no discovery is supplied', async () => {
		const result = await findReachableRelays({
			baked: BAKED,
			probe: async () => []
		});

		expect(result).toEqual({ source: 'none', addresses: [], askedAleph: false });
	});

	it('skips the probe entirely when nothing was baked in and nothing can be discovered', async () => {
		const probe = vi.fn(async () => []);
		const result = await findReachableRelays({ baked: ['', '  '], probe });

		expect(probe).not.toHaveBeenCalled();
		expect(result.source).toBe('none');
	});
});

describe('readStoredRelayOptIn', () => {
	beforeEach(() => localStorage.removeItem(RELAY_OPT_IN_STORAGE_KEY));

	it('is off until somebody turns it on', () => {
		// Read straight from storage rather than through the store, because this
		// is the answer `createLibp2pConfig` needs before any component mounts.
		expect(readStoredRelayOptIn()).toBe(false);
	});

	it('remembers the choice across sessions, in both directions', () => {
		setRelayOptIn(true);
		expect(readStoredRelayOptIn()).toBe(true);

		setRelayOptIn(false);
		expect(readStoredRelayOptIn()).toBe(false);
	});
});
