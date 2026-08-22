import { describe, expect, it } from 'vitest';
import { createPeerRoster, transportsOf } from './peer-roster.js';

/** A clock and a timer queue we drive by hand, so no test waits for real seconds. */
function harness({ graceMs = 8000 } = {}) {
	let clock = 1000;
	/** @type {Map<number, {at: number, fn: () => void}>} */
	const timers = new Map();
	let nextHandle = 1;

	const roster = createPeerRoster({
		graceMs,
		now: () => clock,
		schedule: (/** @type {() => void} */ fn, /** @type {number} */ ms) => {
			const handle = nextHandle++;
			timers.set(handle, { at: clock + ms, fn });
			return handle;
		},
		cancel: (/** @type {number} */ handle) => timers.delete(handle)
	});

	return {
		roster,
		advance(/** @type {number} */ ms) {
			clock += ms;
			for (const [handle, timer] of [...timers]) {
				if (timer.at <= clock) {
					timers.delete(handle);
					timer.fn();
				}
			}
		},
		pending: () => timers.size
	};
}

/** A libp2p stand-in: only the four members the roster actually touches. */
function fakeNode(/** @type {any[]} */ existing = []) {
	/** @type {Map<string, Set<(event: any) => void>>} */
	const handlers = new Map();
	return {
		getConnections: () => existing,
		addEventListener(/** @type {string} */ type, /** @type {(event: any) => void} */ fn) {
			if (!handlers.has(type)) handlers.set(type, new Set());
			handlers.get(type)?.add(fn);
		},
		removeEventListener(/** @type {string} */ type, /** @type {(event: any) => void} */ fn) {
			handlers.get(type)?.delete(fn);
		},
		emit(/** @type {string} */ type, /** @type {any} */ detail) {
			for (const fn of handlers.get(type) ?? []) fn({ detail });
		},
		listenerCount: (/** @type {string} */ type) => handlers.get(type)?.size ?? 0
	};
}

const connection = (/** @type {string} */ peerId, addr = '/ip4/1.2.3.4/tcp/4001/ws') => ({
	remotePeer: { toString: () => peerId },
	remoteAddr: { toString: () => addr }
});

describe('peer roster', () => {
	it('lists a peer once it connects', () => {
		const { roster } = harness();
		const node = fakeNode();
		roster.observe(node);

		node.emit('connection:open', connection('alice'));

		expect(roster.list().map((p) => p.peerId)).toEqual(['alice']);
		expect(roster.list()[0].state).toBe('connected');
	});

	it('picks up connections that already existed when it attached', () => {
		// A component mounting after the node has been talking for a while would
		// otherwise show nothing until the next event, which can be minutes.
		const { roster } = harness();
		roster.observe(fakeNode([connection('alice'), connection('bob')]));

		expect(roster.list().map((p) => p.peerId)).toEqual(['alice', 'bob']);
	});

	it('keeps a peer through a short drop rather than removing it', () => {
		const { roster, advance } = harness({ graceMs: 8000 });
		const node = fakeNode();
		roster.observe(node);

		node.emit('connection:open', connection('alice'));
		node.emit('connection:close', connection('alice'));

		expect(roster.list()).toHaveLength(1);
		expect(roster.list()[0].state).toBe('reconnecting');

		advance(3000);
		expect(roster.list()).toHaveLength(1);
	});

	it('a peer that comes back keeps its place and its arrival time', () => {
		const { roster, advance } = harness();
		const node = fakeNode();
		roster.observe(node);

		node.emit('connection:open', connection('alice'));
		const arrived = roster.list()[0].since;

		node.emit('connection:open', connection('bob'));
		node.emit('connection:close', connection('alice'));
		advance(2000);
		node.emit('connection:open', connection('alice'));

		// Still first, and still the same arrival: it never left as far as the
		// list is concerned.
		expect(roster.list().map((p) => p.peerId)).toEqual(['alice', 'bob']);
		expect(roster.list()[0].since).toBe(arrived);
		expect(roster.list()[0].state).toBe('connected');
	});

	it('removes a peer that stays away past the grace period', () => {
		const { roster, advance } = harness({ graceMs: 8000 });
		const node = fakeNode();
		roster.observe(node);

		node.emit('connection:open', connection('alice'));
		node.emit('connection:close', connection('alice'));

		advance(7999);
		expect(roster.list()).toHaveLength(1);

		advance(2);
		expect(roster.list()).toHaveLength(0);
	});

	it('closing one of two connections to the same peer changes nothing visible', () => {
		const { roster } = harness();
		const node = fakeNode();
		roster.observe(node);

		node.emit('connection:open', connection('alice', '/ip4/1.2.3.4/tcp/4001/ws'));
		node.emit('connection:open', connection('alice', '/ip4/1.2.3.4/udp/1/webrtc'));
		node.emit('connection:close', connection('alice'));

		expect(roster.list()[0].state).toBe('connected');
	});

	it('orders by first sight, not by state', () => {
		const { roster, advance } = harness();
		const node = fakeNode();
		roster.observe(node);

		node.emit('connection:open', connection('alice'));
		advance(10);
		node.emit('connection:open', connection('bob'));
		advance(10);
		node.emit('connection:open', connection('carol'));

		// Bob wobbles. A list sorted by state would move him; this one must not.
		node.emit('connection:close', connection('bob'));

		expect(roster.list().map((p) => p.peerId)).toEqual(['alice', 'bob', 'carol']);
	});

	it('does not announce a change when nothing a reader can see changed', () => {
		const { roster } = harness();
		const node = fakeNode();
		roster.observe(node);

		let announcements = 0;
		roster.onChange(() => announcements++);
		expect(announcements).toBe(1); // the current list, on subscribe

		node.emit('connection:open', connection('alice'));
		expect(announcements).toBe(2);

		// A close that leaves another connection open, then a reopen: the visible
		// list is identical at the end, so nothing further is announced.
		node.emit('connection:open', connection('alice'));
		const afterSecond = announcements;
		node.emit('connection:close', connection('alice'));
		// One of two connections closed: the peer is still connected, and the
		// connection count is not part of what a reader sees.
		expect(announcements).toBe(afterSecond);
	});

	it('detaching removes the listeners it added', () => {
		const { roster } = harness();
		const node = fakeNode();
		const detach = roster.observe(node);

		expect(node.listenerCount('connection:open')).toBe(1);
		detach();
		expect(node.listenerCount('connection:open')).toBe(0);
	});

	it('survives a node that is not there yet', () => {
		const { roster } = harness();
		expect(() => roster.observe(null)()).not.toThrow();
	});

	it('cancels pending removals when stopped', () => {
		const { roster, advance, pending } = harness();
		const node = fakeNode();
		roster.observe(node);

		node.emit('connection:open', connection('alice'));
		node.emit('connection:close', connection('alice'));
		expect(pending()).toBe(1);

		roster.stop();
		expect(pending()).toBe(0);
		advance(20_000);
		expect(roster.list()).toHaveLength(0);
	});
});

describe('transportsOf', () => {
	it('names what the address says', () => {
		expect(transportsOf('/ip4/1.2.3.4/udp/1/webrtc')).toEqual(['webrtc']);
		expect(transportsOf('/dns4/relay.example/tcp/443/tls/ws')).toEqual(['wss']);
		expect(transportsOf('/ip4/1.2.3.4/tcp/4001/ws')).toEqual(['ws']);
	});

	it('names both halves of a relayed webrtc address', () => {
		expect(transportsOf('/dns4/r.example/tcp/443/tls/ws/p2p/QmR/p2p-circuit/webrtc')).toEqual([
			'webrtc',
			'circuit',
			'wss'
		]);
	});

	it('says nothing about an address it cannot read', () => {
		expect(transportsOf('')).toEqual([]);
		expect(transportsOf('/ip4/1.2.3.4/tcp/4001')).toEqual([]);
	});
});
