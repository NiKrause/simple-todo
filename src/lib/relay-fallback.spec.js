import { describe, expect, it, vi } from 'vitest';
import { recoverRelayConnection } from './relay-fallback.js';

/** @param {Partial<Parameters<typeof recoverRelayConnection>[0]>} overrides */
const run = (overrides) =>
	recoverRelayConnection({
		isConnected: () => false,
		discover: async () => ['/dns4/a.example/tcp/443/tls/ws/p2p/12D3KooWA'],
		probe: async (candidates) => candidates,
		connect: async () => undefined,
		...overrides
	});

describe('recoverRelayConnection', () => {
	it('does nothing while a baked relay is still answering', async () => {
		const discover = vi.fn();
		const result = await run({ isConnected: () => true, discover });
		expect(result.outcome).toBe('already-connected');
		// The point of baked-first: no directory lookup when it is not needed.
		expect(discover).not.toHaveBeenCalled();
	});

	it('dials the first reachable relay Aleph knows about', async () => {
		const connect = vi.fn(async () => undefined);
		const result = await run({
			discover: async () => ['/dns4/dead.example/tcp/443/tls/ws/p2p/12D3KooWD', '/dns4/live.example/tcp/443/tls/ws/p2p/12D3KooWL'],
			probe: async () => ['/dns4/live.example/tcp/443/tls/ws/p2p/12D3KooWL'],
			connect
		});
		expect(result.outcome).toBe('connected');
		expect(connect).toHaveBeenCalledTimes(1);
		expect(connect).toHaveBeenCalledWith('/dns4/live.example/tcp/443/tls/ws/p2p/12D3KooWL');
	});

	it('stops before probing when the baked relay arrives late', async () => {
		// The directory fetch is not instant; a baked address coming up during it
		// makes the whole probe wave pointless.
		let connected = false;
		const probe = vi.fn(async (/** @type {string[]} */ c) => c);
		const result = await recoverRelayConnection({
			isConnected: () => connected,
			discover: async () => {
				connected = true;
				return ['/dns4/a.example/tcp/443/tls/ws/p2p/12D3KooWA'];
			},
			probe,
			connect: async () => undefined
		});
		expect(result.outcome).toBe('already-connected');
		expect(probe).not.toHaveBeenCalled();
	});

	it('reports the distinct dead ends rather than one generic failure', async () => {
		expect((await run({ discover: async () => [] })).outcome).toBe('none-registered');
		expect((await run({ probe: async () => [] })).outcome).toBe('none-reachable');
		expect(
			(
				await run({
					discover: async () => {
						throw new Error('aleph down');
					}
				})
			).outcome
		).toBe('failed');
		expect(
			(
				await run({
					connect: async () => {
						throw new Error('refused');
					}
				})
			).outcome
		).toBe('failed');
	});
});
