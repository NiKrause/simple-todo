<script>
	import { onDestroy } from 'svelte';
	import { writable } from 'svelte/store';
	import { formatPeerId } from '../../utils.js';
	import TransportBadge from './TransportBadge.svelte';
	import { systemToasts } from '../../toast-store.js';

	// Plugin interface - only needs libp2p instance
	export let libp2p = null;
	export let title = 'Connected Peers';
	export let emptyMessage = 'No peers connected yet.';
	export let showOnlineIndicator = true;
	export let autoConnect = true;

	// Internal state - completely self-contained
	const peers = writable([]);
	let currentPeers = [];
	peers.subscribe((p) => (currentPeers = p));

	// Internal peer management state
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const discoveredPeersInfo = new Map();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const peerConnectionTransports = new Map();
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
		
		// Group connections by peer
		const connectionsByPeer = new Map();
		allConnections.forEach((connection) => {
			if (!connection?.remotePeer) return;
			const peerIdStr = connection?.remotePeer?.toString();
			if (!peerIdStr) return;
			
			if (!connectionsByPeer.has(peerIdStr)) {
				connectionsByPeer.set(peerIdStr, []);
			}
			connectionsByPeer.get(peerIdStr).push(connection);
		});

		// Process each peer's connections
		connectionsByPeer.forEach((connections, peerIdStr) => {
			// Skip if already in our peers list
			if (currentPeers.some((peer) => peer.peerId === peerIdStr)) {
				// Still refresh transports from all connections
				refreshTransportsFromConnections(peerIdStr);
				return;
			}

			console.log('🔗 Found existing connection to:', formatPeerId(peerIdStr));

			// Extract transports from all connections for this peer
			const allTransports = new Set();
			connections.forEach(connection => {
				const transports = extractTransportsFromConnection(connection);
				transports.forEach(t => allTransports.add(t));
				
				// Track connection transports
				if (!peerConnectionTransports.has(peerIdStr)) {
					peerConnectionTransports.set(peerIdStr, new Map());
				}
				peerConnectionTransports.get(peerIdStr).set(connection.id, new Set(transports));
			});

			// Add to peers list with all transports
			peers.update((peers) => [
				...peers,
				{
					peerId: peerIdStr,
					transports: allTransports.size > 0 ? Array.from(allTransports) : ['websocket'] // fallback
				}
			]);
		});
	}

	function setupPeerDiscoveryHandlers() {
		// Handle peer discovery events
		const onPeerDiscovery = async (event) => {
			const { id: peerId, multiaddrs } = event.detail;
			const peerIdStr = peerId?.toString();

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

			// Auto-connect if enabled
			if (autoConnect) {
				try {
					await libp2p.dial(peerId);
				} catch (error) {
					console.warn('❌ Failed to connect to peer:', formatPeerId(peerIdStr), error.message);
					discoveredPeersInfo.delete(peerIdStr);
				}
			}
		};

		// Handle successful connections
		const onPeerConnect = (event) => {
			if (!event?.detail) return;
			// In libp2p v3, event.detail can be either a peerId directly or an object
			const peerId = event.detail?.id || event.detail?.remotePeer || event.detail;
			const peerIdStr = peerId?.toString();

			if (!peerIdStr) return;

			console.log(`✅ Connected to peer ${peerIdStr}`);
			systemToasts.showPeerConnected(peerIdStr);

			// Add to peers list if not already there, but refresh transports from actual connections
			const existingPeer = currentPeers.find((peer) => peer.peerId === peerIdStr);
			if (!existingPeer) {
				// Get actual transports from active connections
				const connections = libp2p.getConnections(peerId);
				const actualTransports = new Set();
				connections.forEach(conn => {
					const connTransports = extractTransportsFromConnection(conn);
					connTransports.forEach(t => actualTransports.add(t));
				});

				const transports = actualTransports.size > 0 
					? Array.from(actualTransports) 
					: ['webrtc']; // fallback

				peers.update((peers) => [...peers, { peerId: peerIdStr, transports }]);
				discoveredPeersInfo.delete(peerIdStr);
			} else {
				// Peer already exists, refresh transports from all active connections
				refreshTransportsFromConnections(peerIdStr);
			}
		};

		// Handle disconnections
		const onPeerDisconnect = (event) => {
			if (!event?.detail) return;
			// In libp2p v3, event.detail can be either a peerId directly or an object
			const peerId = event.detail?.id || event.detail?.remotePeer || event.detail;
			const peerIdStr = peerId?.toString();

			if (!peerIdStr) return;

			console.log(`❌ Disconnected from peer ${peerIdStr}`);
			systemToasts.showPeerDisconnected(peerIdStr);

			// Check if peer still has active connections
			const remainingConnections = libp2p.getConnections(peerId);
			if (remainingConnections && remainingConnections.length > 0) {
				// Still connected via other transports, just refresh the transport list
				refreshTransportsFromConnections(peerIdStr);
			} else {
				// No more connections, remove peer
				peers.update((peers) => peers.filter((peer) => peer.peerId !== peerIdStr));
				discoveredPeersInfo.delete(peerIdStr);
				peerConnectionTransports.delete(peerIdStr);
			}
		};

		// Handle connection events for transport tracking
		const onConnectionOpen = (event) => {
			try {
				console.log('🔍 Connection open event:', event);
				if (!event?.detail) return;
				const connection = event.detail;
				if (!connection?.remotePeer) return;
				const peerIdStr = connection?.remotePeer?.toString();

				if (!peerIdStr || !connection?.id) return;

				const connectionTransports = extractTransportsFromConnection(connection);

				if (connectionTransports.length > 0) {
					if (!peerConnectionTransports.has(peerIdStr)) {
						peerConnectionTransports.set(peerIdStr, new Map());
					}
					peerConnectionTransports.get(peerIdStr).set(connection.id, new Set(connectionTransports));
					// Refresh transports from all active connections
					refreshTransportsFromConnections(peerIdStr);
				}
			} catch (error) {
				console.warn('⚠️ Error handling connection open event:', error);
			}
		};

		const onConnectionClose = (event) => {
			if (!event?.detail) return;
			const connection = event.detail;
			if (!connection?.remotePeer) return;
			const peerIdStr = connection?.remotePeer?.toString();

			if (!peerIdStr) return;

			if (peerConnectionTransports.has(peerIdStr)) {
				const peerConnections = peerConnectionTransports.get(peerIdStr);
				peerConnections.delete(connection.id);

				if (peerConnections.size === 0) {
					peerConnectionTransports.delete(peerIdStr);
				}
				
				// Always refresh transports from remaining active connections
				refreshTransportsFromConnections(peerIdStr);
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
	function extractTransportsFromMultiaddrs(multiaddrs) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const transports = new Set();

		multiaddrs.forEach((multiaddr) => {
			const addrStr = multiaddr.toString();

			if (addrStr.includes('/webrtc')) transports.add('webrtc');
			if (addrStr.includes('/ws') || addrStr.includes('/wss')) transports.add('websocket');
			if (addrStr.includes('/webtransport')) transports.add('webtransport');
			if (addrStr.includes('/p2p-circuit')) transports.add('circuit-relay');
		});

		return Array.from(transports);
	}

	function extractTransportsFromConnection(connection) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const transports = new Set();

		if (!connection.remoteAddr) return [];

		const addrStr = connection.remoteAddr.toString();

		if (addrStr.includes('/webrtc') && !addrStr.includes('/p2p-circuit')) {
			transports.add('webrtc');
		} else if (addrStr.includes('/p2p-circuit')) {
			transports.add('circuit-relay');
		} else if (addrStr.includes('/webtransport')) {
			transports.add('webtransport');
		} else if (
			(addrStr.includes('/ws') || addrStr.includes('/wss')) &&
			!addrStr.includes('/p2p-circuit')
		) {
			transports.add('websocket');
		} else if (addrStr.includes('/tcp/')) {
			transports.add('tcp');
		}

		return Array.from(transports);
	}

	/**
	 * Refresh transports for a peer from all active connections
	 * This ensures badges always reflect the actual active transports
	 */
	function refreshTransportsFromConnections(peerIdStr) {
		if (!libp2p) return;
		
		// Get all active connections for this peer
		const connections = libp2p.getConnections(peerIdStr);
		const allTransports = new Set();
		
		// Extract transports from all active connections
		connections.forEach(connection => {
			const transports = extractTransportsFromConnection(connection);
			transports.forEach(t => allTransports.add(t));
		});
		
		// Update peer transports in the UI
		peers.update((peers) => {
			const peerIndex = peers.findIndex((peer) => peer.peerId === peerIdStr);
			if (peerIndex !== -1) {
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

	function updatePeerTransports(peerIdStr) {
		// Use the new refresh function that checks actual connections
		refreshTransportsFromConnections(peerIdStr);
	}

	// Public API for external control
	export function disconnectPeer(peerId) {
		if (!libp2p) return;

		const connections = libp2p.getConnections(peerId);
		connections.forEach((conn) => conn.close());
	}

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
	}

	onDestroy(cleanup);
</script>

<div class="rounded-lg bg-white p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">{title} ({$peers.length})</h2>
	{#if $peers.length > 0}
		<div class="space-y-2">
			{#each $peers as peer (peer.peerId)}
				<div class="flex items-center space-x-2">
					{#if showOnlineIndicator}
						<div class="h-2 w-2 rounded-full bg-green-500" title="Online"></div>
					{/if}
					<code class="rounded bg-gray-100 px-2 py-1 text-sm">{formatPeerId(peer.peerId)}</code>
					{#each peer.transports as transport (transport)}
						<TransportBadge {transport} />
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
