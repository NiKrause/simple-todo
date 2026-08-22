/**
 * Who is here, in a list a person can actually use.
 *
 * libp2p does not offer a list of peers; it offers a stream of events. A
 * connection drops and returns 300 ms later, and that is two events — while for
 * the person watching it is the same someone, present the whole time.
 * `ConnectedPeers` rendered straight from those events, which is why the panel
 * flickered and why a row could not be clicked: it had moved by the time the
 * finger arrived.
 *
 * Three rules, and each of them is there because the naive version is worse:
 *
 *   - **A peer leaves after a grace period, not on `close`.** Anything shorter
 *     turns a reconnect into a disappearance and a reappearance.
 *   - **Order is fixed at first sight.** Sorting by state means a row jumps
 *     whenever its state changes, which is exactly when somebody is looking at
 *     it.
 *   - **Wobbling is a property, not an absence.** A peer between connections is
 *     `reconnecting` and stays in place, rather than being removed and re-added.
 *
 * Deliberately free of Svelte and of anything else in this app: events in, an
 * array out. Clock and timers are injected so the tests do not have to wait for
 * real seconds, and so this can move to a package later without dragging a
 * runtime with it — `qr-peers` in `@le-space/libp2p-webrtc-qr` is display-only
 * by design and leaves exactly this gap. It stays here until a second app
 * genuinely needs it; one consumer is not a shared module.
 *
 * @param {{
 *   graceMs?: number,
 *   now?: () => number,
 *   schedule?: (fn: () => void, ms: number) => any,
 *   cancel?: (handle: any) => void
 * }} [options]
 */
export function createPeerRoster({
	graceMs = 8000,
	now = () => Date.now(),
	schedule = setTimeout,
	cancel = clearTimeout
} = {}) {
	/** @type {Map<string, {peerId: string, since: number, lastSeen: number, state: 'connected'|'reconnecting', connections: number, transports: Set<string>, timer: any}>} */
	const peers = new Map();
	/** @type {Set<(list: any[]) => void>} */
	const listeners = new Set();
	let lastSignature = '';

	function snapshot() {
		return (
			[...peers.values()]
				// First seen, first listed. `since` is set once and never touched
				// again, so a peer that reconnects keeps its place rather than
				// jumping to the end as a stranger.
				.sort((a, b) => a.since - b.since || (a.peerId < b.peerId ? -1 : 1))
				// Only what a reader sees. `lastSeen` and the connection count are
				// bookkeeping: both move on every event, so putting them in here
				// defeated the deduplication below entirely - every event changed
				// the signature and the panel repainted exactly as often as before.
				.map(({ peerId, since, state, transports }) => ({
					peerId,
					since,
					state,
					transports: [...transports].sort()
				}))
		);
	}

	// Emitted only when the list actually differs. Without this every event -
	// including the ones that change nothing a reader can see - would repaint the
	// panel, which is half of what made it flicker.
	function emit() {
		const list = snapshot();
		const signature = JSON.stringify(list);
		if (signature === lastSignature) return;
		lastSignature = signature;
		for (const listener of listeners) listener(list);
	}

	/** @param {string} peerId @param {string[]} [transports] */
	function seen(peerId, transports = []) {
		if (!peerId) return;
		let entry = peers.get(peerId);
		if (!entry) {
			entry = {
				peerId,
				since: now(),
				lastSeen: now(),
				state: 'connected',
				connections: 0,
				transports: new Set(),
				timer: null
			};
			peers.set(peerId, entry);
		}
		if (entry.timer != null) {
			cancel(entry.timer);
			entry.timer = null;
		}
		entry.lastSeen = now();
		entry.state = 'connected';
		entry.connections += 1;
		for (const transport of transports) entry.transports.add(transport);
		emit();
	}

	/** @param {string} peerId */
	function gone(peerId) {
		const entry = peers.get(peerId);
		if (!entry) return;
		entry.connections = Math.max(0, entry.connections - 1);
		entry.lastSeen = now();
		// Another connection to the same peer is still open: nothing has ended.
		if (entry.connections > 0) {
			emit();
			return;
		}
		entry.state = 'reconnecting';
		if (entry.timer != null) cancel(entry.timer);
		entry.timer = schedule(() => {
			peers.delete(peerId);
			emit();
		}, graceMs);
		emit();
	}

	/**
	 * Attach to a node. Returns the detach function, so a caller that mounts and
	 * unmounts — which is every Svelte component — cannot leak listeners.
	 *
	 * @param {any} libp2p
	 */
	function observe(libp2p) {
		if (!libp2p) return () => {};

		const onOpen = (/** @type {any} */ event) => {
			const connection = event?.detail;
			seen(
				connection?.remotePeer?.toString?.() ?? '',
				transportsOf(connection?.remoteAddr?.toString?.() ?? '')
			);
		};
		const onClose = (/** @type {any} */ event) => {
			gone(event?.detail?.remotePeer?.toString?.() ?? '');
		};

		// Existing connections first: a component mounted after the node was
		// already talking to somebody would otherwise show an empty list until the
		// next event, which can be minutes.
		for (const connection of libp2p.getConnections?.() ?? []) {
			seen(
				connection?.remotePeer?.toString?.() ?? '',
				transportsOf(connection?.remoteAddr?.toString?.() ?? '')
			);
		}

		libp2p.addEventListener('connection:open', onOpen);
		libp2p.addEventListener('connection:close', onClose);

		return () => {
			libp2p.removeEventListener('connection:open', onOpen);
			libp2p.removeEventListener('connection:close', onClose);
		};
	}

	return {
		observe,
		list: snapshot,
		/** @param {(list: any[]) => void} listener */
		onChange(listener) {
			listeners.add(listener);
			listener(snapshot());
			return () => listeners.delete(listener);
		},
		/** Drop every pending removal. For teardown; the list itself is discarded. */
		stop() {
			for (const entry of peers.values()) if (entry.timer != null) cancel(entry.timer);
			peers.clear();
			listeners.clear();
		}
	};
}

/**
 * The transports named in a multiaddr, for the badge beside a peer.
 *
 * Read from the address rather than asked of the connection: libp2p reports the
 * negotiated transport in several shapes across versions, and the address is
 * the one thing that has always been there.
 *
 * @param {string} address
 */
export function transportsOf(address) {
	if (!address) return [];
	const found = [];
	if (address.includes('/webrtc')) found.push('webrtc');
	if (address.includes('/p2p-circuit')) found.push('circuit');
	if (address.includes('/wss') || address.includes('/tls/ws')) found.push('wss');
	else if (address.includes('/ws')) found.push('ws');
	return found;
}
