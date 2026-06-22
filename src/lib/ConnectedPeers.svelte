<script>
	import { onDestroy } from 'svelte';
	import { writable } from 'svelte/store';
	import { formatPeerId } from './utils.js';
	import TransportBadge from './TransportBadge.svelte';

	/**
	 * @typedef {{ peerId: string, transports: string[] }} PeerEntry
	 * @typedef {{ peerId: string, transports: string[], multiaddrs: any[] }} DiscoveredPeerInfo
	 * @typedef {{ event: string, handler: (event: Event) => void | Promise<void> }} EventListenerEntry
	 * @typedef {{ lastFailureAt: number, warningCount: number }} FailedPeerDialState
	 */

	const FAILED_PEER_RETRY_COOLDOWN_MS = 60_000;
	const MAX_WARNINGS_PER_PEER = 1;

	// Plugin interface - only needs libp2p instance
	/** @type {any} */
	export let libp2p = null;
	export let title = 'Connected Peers';
	export let emptyMessage = 'No peers connected yet.';
	export let showOnlineIndicator = true;
	export let autoConnect = true;

	// Internal state - completely self-contained
	const peers = writable(/** @type {PeerEntry[]} */ ([]));
	/** @type {PeerEntry[]} */
	let currentPeers = [];
	peers.subscribe((p) => (currentPeers = p));

	// Internal peer management state
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const discoveredPeersInfo = new Map();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const peerConnectionTransports = new Map();
	/** @type {Map<string, FailedPeerDialState>} */
	const failedPeerDialState = new Map();
	/** @type {EventListenerEntry[]} */
	let eventListeners = [];

	// Initialize when libp2p instance is provided
	$: if (libp2p) {
		initializePeerManagement();
	}

	function initializePeerManagement() {
		console.log('🔍 ConnectedPeers: Setting up peer management...');

		// Clean up any existing listeners
		cleanup();

		// Check for existing connections first
		checkExistingConnections();

		// Set up peer discovery handlers
		setupPeerDiscoveryHandlers();
	}

	function checkExistingConnections() {
		if (!libp2p) return;

		console.log('🔍 Checking for existing connections...');
		const allConnections = libp2p.getConnections();

		allConnections.forEach((/** @type {any} */ connection) => {
			const peerIdStr = connection.remotePeer.toString();

			// Skip if already in our peers list
			if (currentPeers.some((peer) => peer.peerId === peerIdStr)) {
				return;
			}

			console.log('🔗 Found existing connection to:', formatPeerId(peerIdStr));

			// Extract transports from the connection
			const transports = extractTransportsFromConnection(connection);

			// Add to peers list
			peers.update((peers) => [
				...peers,
				{
					peerId: peerIdStr,
					transports: transports.length > 0 ? transports : ['websocket'] // fallback
				}
			]);

			// Track connection transports
			if (!peerConnectionTransports.has(peerIdStr)) {
				peerConnectionTransports.set(peerIdStr, new Map());
			}
			peerConnectionTransports.get(peerIdStr).set(connection.id, new Set(transports));
		});
	}

	function setupPeerDiscoveryHandlers() {
		// Handle peer discovery events
		/** @type {(event: Event) => Promise<void>} */
		const onPeerDiscovery = async (event) => {
			const customEvent = /** @type {CustomEvent<{ id?: { toString(): string }, multiaddrs: any[] }>} */ (event);
			const { id: peerId, multiaddrs } = customEvent.detail;
			const peerIdStr = peerId?.toString();
			if (!peerIdStr) return;

			console.log('🔍 Peer discovered:', formatPeerId(peerIdStr));

			// Skip if already discovered
			if (currentPeers.some((peer) => peer.peerId === peerIdStr)) {
				return;
			}

			// Skip if already connected
			const existingConnections = libp2p.getConnections(peerId);
			if (existingConnections?.length > 0) {
				return;
			}

			// Extract transport protocols
			const detectedTransports = extractTransportsFromMultiaddrs(multiaddrs);

			// Store peer info
			discoveredPeersInfo.set(peerIdStr, {
				peerId: peerIdStr,
				transports: detectedTransports,
				multiaddrs: multiaddrs
			});

			// Auto-connect only for browser-reachable transports, and back off after failures.
			if (autoConnect && isAutoDialCandidate(detectedTransports) && shouldAttemptPeerDial(peerIdStr)) {
				try {
					await libp2p.dial(peerId);
					failedPeerDialState.delete(peerIdStr);
				} catch (error) {
					notePeerDialFailure(peerIdStr, error);
					discoveredPeersInfo.delete(peerIdStr);
				}
			}
		};

		// Handle successful connections
		/** @type {EventListener} */
		const onPeerConnect = (event) => {
			const peerId = /** @type {CustomEvent<any>} */ (event).detail;
			const peerIdStr = peerId?.toString();

			if (!peerIdStr) return;

			// Add to peers list if not already there
			const existingPeer = currentPeers.find((peer) => peer.peerId === peerIdStr);
			if (!existingPeer) {
				const storedPeerInfo = discoveredPeersInfo.get(peerIdStr);
				const transports = storedPeerInfo?.transports || ['webrtc'];

				peers.update((peers) => [...peers, { peerId: peerIdStr, transports }]);
				discoveredPeersInfo.delete(peerIdStr);
			}

			failedPeerDialState.delete(peerIdStr);
		};

		// Handle disconnections
		/** @type {EventListener} */
		const onPeerDisconnect = (event) => {
			const detail = /** @type {CustomEvent<any>} */ (event).detail;
			const peerId = detail.id || detail;
			const peerIdStr = peerId?.toString();

			if (!peerIdStr) return;

			peers.update((peers) => peers.filter((peer) => peer.peerId !== peerIdStr));
			discoveredPeersInfo.delete(peerIdStr);
			peerConnectionTransports.delete(peerIdStr);
		};

		// Handle connection events for transport tracking
		/** @type {EventListener} */
		const onConnectionOpen = (event) => {
			const connection = /** @type {CustomEvent<any>} */ (event).detail;
			const peerIdStr = connection.remotePeer?.toString();

			if (!peerIdStr) return;

			const connectionTransports = extractTransportsFromConnection(connection);

			if (connectionTransports.length > 0) {
				if (!peerConnectionTransports.has(peerIdStr)) {
					peerConnectionTransports.set(peerIdStr, new Map());
				}
				peerConnectionTransports.get(peerIdStr).set(connection.id, new Set(connectionTransports));
				updatePeerTransports(peerIdStr);
			}
		};

		/** @type {EventListener} */
		const onConnectionClose = (event) => {
			const connection = /** @type {CustomEvent<any>} */ (event).detail;
			const peerIdStr = connection.remotePeer?.toString();

			if (!peerIdStr) return;

			if (peerConnectionTransports.has(peerIdStr)) {
				const peerConnections = peerConnectionTransports.get(peerIdStr);
				peerConnections.delete(connection.id);

				if (peerConnections.size === 0) {
					peerConnectionTransports.delete(peerIdStr);
				} else {
					updatePeerTransports(peerIdStr);
				}
			}
		};

		// Register event listeners
		libp2p.addEventListener('peer:discovery', onPeerDiscovery);
		libp2p.addEventListener('peer:connect', onPeerConnect);
		libp2p.addEventListener('peer:disconnect', onPeerDisconnect);
		libp2p.addEventListener('connection:open', onConnectionOpen);
		libp2p.addEventListener('connection:close', onConnectionClose);

		// Store references for cleanup
		eventListeners = [
			{ event: 'peer:discovery', handler: onPeerDiscovery },
			{ event: 'peer:connect', handler: onPeerConnect },
			{ event: 'peer:disconnect', handler: onPeerDisconnect },
			{ event: 'connection:open', handler: onConnectionOpen },
			{ event: 'connection:close', handler: onConnectionClose }
		];
	}

	// Helper functions (moved from p2p.js)
	/**
	 * @param {any[]} multiaddrs
	 */
	function extractTransportsFromMultiaddrs(multiaddrs) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const transports = new Set();

		multiaddrs.forEach((/** @type {any} */ multiaddr) => {
			const addrStr = multiaddr.toString();

			if (addrStr.includes('/webrtc')) transports.add('webrtc');
			if (addrStr.includes('/ws') || addrStr.includes('/wss')) transports.add('websocket');
			if (addrStr.includes('/webtransport')) transports.add('webtransport');
			if (addrStr.includes('/p2p-circuit')) transports.add('circuit-relay');
		});

		return Array.from(transports);
	}

	/**
	 * @param {any} connection
	 */
	function extractTransportsFromConnection(connection) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const transports = new Set();

		if (!connection.remoteAddr) return [];

		const addrStr = connection.remoteAddr.toString();

		if (addrStr.includes('/p2p-circuit')) {
			transports.add('circuit-relay');
		}

		if (addrStr.includes('/webrtc')) {
			transports.add('webrtc');
		}

		if (addrStr.includes('/webtransport')) {
			transports.add('webtransport');
		}

		if (
			(addrStr.includes('/ws') || addrStr.includes('/wss')) &&
			!addrStr.includes('/p2p-circuit')
		) {
			transports.add('websocket');
		}

		if (addrStr.includes('/tcp/') && transports.size === 0) {
			transports.add('tcp');
		}

		return Array.from(transports);
	}

	/**
	 * @param {string} peerIdStr
	 */
	function updatePeerTransports(peerIdStr) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const allTransports = new Set();

		if (peerConnectionTransports.has(peerIdStr)) {
			const peerConnections = peerConnectionTransports.get(peerIdStr);
			for (const [, connectionTransports] of peerConnections) {
				for (const transport of connectionTransports) {
					allTransports.add(transport);
				}
			}
		}

		peers.update((peers) => {
			const peerIndex = peers.findIndex((peer) => peer.peerId === peerIdStr);
			if (peerIndex !== -1) {
				/** @type {PeerEntry[]} */
				const updatedPeers = [...peers];
				updatedPeers[peerIndex] = {
					...updatedPeers[peerIndex],
					transports: Array.from(allTransports)
				};
				return updatedPeers;
			}
			return peers;
		});
	}

	// Public API for external control
	/**
	 * @param {string} peerId
	 */
	export function disconnectPeer(peerId) {
		if (!libp2p) return;

		const connections = libp2p.getConnections(peerId);
		connections.forEach((/** @type {any} */ conn) => conn.close());
	}

	/**
	 * @param {string} peerId
	 */
	export function reconnectPeer(peerId) {
		if (!libp2p) return;

		const peerInfo = discoveredPeersInfo.get(peerId);
		if (peerInfo) {
			return libp2p.dial(peerInfo.multiaddrs);
		}
	}

	export function getPeers() {
		return currentPeers;
	}

	// Cleanup
	function cleanup() {
		if (libp2p && eventListeners.length > 0) {
			eventListeners.forEach(({ event, handler }) => {
				libp2p.removeEventListener(event, handler);
			});
		}
		eventListeners = [];
		discoveredPeersInfo.clear();
		peerConnectionTransports.clear();
		failedPeerDialState.clear();
	}

	/**
	 * @param {string[]} transports
	 * @returns {boolean}
	 */
	function isAutoDialCandidate(transports) {
		return transports.includes('websocket') || transports.includes('webrtc');
	}

	/**
	 * @param {string} peerIdStr
	 * @returns {boolean}
	 */
	function shouldAttemptPeerDial(peerIdStr) {
		const state = failedPeerDialState.get(peerIdStr);

		if (!state) return true;

		return Date.now() - state.lastFailureAt >= FAILED_PEER_RETRY_COOLDOWN_MS;
	}

	/**
	 * @param {string} peerIdStr
	 * @param {unknown} error
	 */
	function notePeerDialFailure(peerIdStr, error) {
		const state = failedPeerDialState.get(peerIdStr) ?? {
			lastFailureAt: 0,
			warningCount: 0
		};

		state.lastFailureAt = Date.now();
		failedPeerDialState.set(peerIdStr, state);

		if (state.warningCount >= MAX_WARNINGS_PER_PEER) {
			return;
		}

		state.warningCount += 1;
		console.warn(
			'Peer dial failed, backing off retry for 60s:',
			formatPeerId(peerIdStr),
			error instanceof Error ? error.message : String(error)
		);
	}

	onDestroy(cleanup);
</script>

<div class="rounded-lg bg-white p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">{title} ({$peers.length})</h2>
	{#if $peers.length > 0}
		<div class="space-y-2">
			{#each $peers as peer (peer.peerId)}
				<div
					class="flex items-center space-x-2"
					data-testid="connected-peer"
					data-peer-id={peer.peerId}
				>
					{#if showOnlineIndicator}
						<div class="h-2 w-2 rounded-full bg-green-500" title="Online"></div>
					{/if}
					<code class="rounded bg-gray-100 px-2 py-1 text-sm">{formatPeerId(peer.peerId)}</code>
					{#each peer.transports as transport (transport)}
						<TransportBadge {transport} peerId={peer.peerId} />
					{/each}

					<!-- Optional: Add action buttons -->
					<button
						on:click={() => disconnectPeer(peer.peerId)}
						class="text-xs text-red-600 hover:text-red-800"
						title="Disconnect peer"
					>
						✕
					</button>
				</div>
			{/each}
		</div>
	{:else}
		<p class="text-gray-500">{emptyMessage}</p>
	{/if}
</div>
