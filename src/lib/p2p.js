import { writable } from 'svelte/store';

import { createLibp2p } from 'libp2p';
import { createHelia } from 'helia';
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core';
import { multiaddr } from '@multiformats/multiaddr';
import { createLibp2pConfig } from './libp2p-config.js';
import { initializeDatabase } from './db-actions.js';

// Export libp2p instance for plugins
export const libp2pStore = writable(/** @type {any} */ (null));
export const peerIdStore = writable(/** @type {string | null} */ (null));

// Add initialization state store
export const initializationStore = writable(
	/** @type {{ isInitializing: boolean, isInitialized: boolean, error: string | null }} */ ({
		isInitializing: false,
		isInitialized: false,
		error: null
	})
);

let libp2p = /** @type {any} */ (null);
let helia = /** @type {any} */ (null);
let orbitdb = /** @type {any} */ (null);

let peerId = /** @type {string | null} */ (null);
let todoDB = /** @type {any} */ (null);
const MANUAL_CONNECT_STABILIZATION_MS = 3_000;
const DISCOVERY_DIAL_RETRY_COOLDOWN_MS = 5_000;
const DISCOVERY_DIAL_TIMEOUT_MS = 10_000;
/** @type {Map<string, { peer: any, multiaddrs: any[], isDialing: boolean, lastDialAttemptAt: number }>} */
const discoveredPeers = new Map();

/**
 * Initialize the P2P network after user consent
 * This function should be called only after the user has accepted the consent modal
 */
export async function initializeP2P() {
	console.log('🚀 Starting P2P initialization after user consent...');

	try {
		// Set initialization state
		initializationStore.set({ isInitializing: true, isInitialized: false, error: null });

		// Create libp2p configuration and node
		const config = await createLibp2pConfig();
		libp2p = await createLibp2p(config);
		libp2pStore.set(libp2p); // Make available to plugins
		console.log(`✅ libp2p node created`);

		// Get and set peer ID
		peerId = libp2p.peerId.toString();
		console.log(`✅ peerId is ${peerId}`);
		peerIdStore.set(peerId);
		discoveredPeers.clear();
		setupPubsubDiscoveryAutoDial();

		// Create Helia (IPFS) instance
		helia = await createHelia({ libp2p });
		console.log(`✅ Helia created`);

		// Create OrbitDB instance
		console.log('🛬 Creating OrbitDB instance...');
		orbitdb = await createOrbitDB({ ipfs: helia, id: 'simple-todo-app' });
		todoDB = await orbitdb.open('simple-todos', {
			type: 'keyvalue', //Stores data as key-value pairs supports basic operations: put(), get(), delete()
			create: true, // Allows the database to be created if it doesn't exist
			sync: true, // Enables automatic synchronization with other peers
			AccessController: IPFSAccessController({ write: ['*'] }) //defines who can write to the database, ["*"] is a wildcard that allows all peers to write to the database, This creates a fully collaborative environment where any peer can add/edit TODOs
		});

		console.log('✅ Database opened successfully with OrbitDBAccessController:', {
			address: todoDB.address,
			type: todoDB.type,
			accessController: todoDB.access
		});

		// Initialize database stores and actions
		await initializeDatabase(orbitdb, todoDB);

		// Mark initialization as complete
		initializationStore.set({ isInitializing: false, isInitialized: true, error: null });
		installE2ETestHooks();
		console.log('🎉 P2P initialization completed successfully!');
	} catch (error) {
		console.error('❌ Failed to initialize P2P:', error);
		initializationStore.set({
			isInitializing: false,
			isInitialized: false,
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}

function installE2ETestHooks() {
	if (typeof window === 'undefined' || import.meta.env.VITE_E2E !== 'true') return;

	/** @type {Window & typeof globalThis & { __simpleTodoE2E?: Record<string, unknown> }} */ (
		window
	).__simpleTodoE2E = {
		getPeerId: () => peerId,
		getMultiaddrs: () =>
			libp2p?.getMultiaddrs?.().map((/** @type {any} */ addr) => addr.toString()) ?? [],
		getConnectionCount: () => libp2p?.getConnections?.().length ?? 0,
		getConnectedPeerIds: () =>
			libp2p
				?.getConnections?.()
				.map((/** @type {any} */ connection) => connection.remotePeer?.toString())
				.filter(Boolean) ?? [],
		getDiscoveredPeerIds: () => Array.from(discoveredPeers.keys()),
		getDiscoveredPeers: () =>
			Array.from(discoveredPeers.entries()).map(([peerId, peer]) => ({
				peerId,
				multiaddrs: peer.multiaddrs.map((/** @type {any} */ addr) => addr.toString())
			})),
		getConnections: () =>
			libp2p?.getConnections?.().map((/** @type {any} */ connection) => ({
				remotePeer: connection.remotePeer?.toString() ?? null,
				remoteAddr: connection.remoteAddr?.toString() ?? null
			})) ?? [],
		connectToMultiaddr
	};
}

function setupPubsubDiscoveryAutoDial() {
	if (!libp2p) return;

	/** @param {Event} event */
	const handlePeerDiscovery = async (event) => {
		const detail = /** @type {CustomEvent<{ id?: { toString(): string }, multiaddrs?: any[] }>} */ (
			event
		).detail;
		const discoveredPeer = detail?.id;
		const discoveredPeerId = discoveredPeer?.toString();

		if (!discoveredPeer || !discoveredPeerId || discoveredPeerId === peerId) {
			return;
		}

		const peerInfo = updateDiscoveredPeer(discoveredPeer, detail?.multiaddrs ?? []);

		await dialDiscoveredPeer(discoveredPeerId, peerInfo, 'peer:discovery');
	};

	const handleConnectivityChanged = async () => {
		await retryDiscoveredPeerDials('connectivity:update');
	};

	libp2p.addEventListener('peer:discovery', handlePeerDiscovery);
	libp2p.addEventListener('self:peer:update', handleConnectivityChanged);
	libp2p.addEventListener('peer:update', handleConnectivityChanged);
	libp2p.addEventListener('connection:close', handleConnectivityChanged);
}

/**
 * @param {any} discoveredPeer
 * @param {any[]} multiaddrs
 */
function updateDiscoveredPeer(discoveredPeer, multiaddrs) {
	const discoveredPeerId = discoveredPeer.toString();
	const existingPeerInfo = discoveredPeers.get(discoveredPeerId);
	const normalizedMultiaddrs = normalizeDiscoveredMultiaddrs(discoveredPeerId, multiaddrs);
	const mergedMultiaddrs = dedupeMultiaddrs([
		...(existingPeerInfo?.multiaddrs ?? []),
		...normalizedMultiaddrs
	]);

	const peerInfo = {
		peer: discoveredPeer,
		multiaddrs: mergedMultiaddrs,
		isDialing: existingPeerInfo?.isDialing ?? false,
		lastDialAttemptAt: existingPeerInfo?.lastDialAttemptAt ?? 0
	};

	discoveredPeers.set(discoveredPeerId, peerInfo);
	return peerInfo;
}

/**
 * @param {string} discoveredPeerId
 * @param {any[]} multiaddrs
 * @returns {any[]}
 */
function normalizeDiscoveredMultiaddrs(discoveredPeerId, multiaddrs) {
	return multiaddrs
		.map((addr) => {
			try {
				const parsed = typeof addr === 'string' ? multiaddr(addr) : addr;
				const addrString = parsed.toString();

				if (parsed.getPeerId?.() != null) {
					return parsed;
				}

				if (!addrString.startsWith('/')) {
					return null;
				}

				return multiaddr(`${addrString}/p2p/${discoveredPeerId}`);
			} catch {
				return null;
			}
		})
		.filter(Boolean);
}

/**
 * @param {any[]} multiaddrs
 * @returns {any[]}
 */
function dedupeMultiaddrs(multiaddrs) {
	return Array.from(new Map(multiaddrs.map((addr) => [addr.toString(), addr])).values());
}

/**
 * @param {string} discoveredPeerId
 * @param {{ peer: any, multiaddrs: any[], isDialing: boolean, lastDialAttemptAt: number }} peerInfo
 * @param {string} reason
 */
async function dialDiscoveredPeer(discoveredPeerId, peerInfo, reason) {
	if (!libp2p) return;

	if (peerInfo.isDialing) {
		return;
	}

	if (!shouldDialDiscoveredPeer(peerInfo)) {
		return;
	}

	const dialCandidates = selectDiscoveredDialCandidates(peerInfo.multiaddrs);
	const existingConnections = libp2p.getConnections(peerInfo.peer) ?? [];
	const shouldAttemptWebRTCUpgrade =
		existingConnections.length > 0 &&
		!hasWebRTCConnection(existingConnections) &&
		dialCandidates.some(isWebRTCDialCandidate);

	if (existingConnections.length > 0 && !shouldAttemptWebRTCUpgrade) {
		return;
	}

	peerInfo.isDialing = true;
	peerInfo.lastDialAttemptAt = Date.now();

	try {
		await mergeDiscoveredPeerMultiaddrs(peerInfo.peer, dialCandidates);

		console.log('🔍 Pubsub discovered peer, dialing:', {
			peerId: discoveredPeerId,
			reason,
			candidates: dialCandidates.map((addr) => addr.toString())
		});

		await dialDiscoveredPeerCandidates(peerInfo.peer, dialCandidates);
	} catch (error) {
		console.warn(
			'Failed to dial pubsub-discovered peer:',
			discoveredPeerId,
			error instanceof Error ? error.message : String(error)
		);
	} finally {
		peerInfo.isDialing = false;
	}
}

/**
 * @param {any[]} connections
 * @returns {boolean}
 */
function hasWebRTCConnection(connections) {
	return connections.some((connection) => connection.remoteAddr?.toString().includes('/webrtc'));
}

/**
 * @param {any} peer
 * @param {any[]} multiaddrs
 */
async function mergeDiscoveredPeerMultiaddrs(peer, multiaddrs) {
	if (!libp2p?.peerStore?.merge || multiaddrs.length === 0) return;

	await libp2p.peerStore.merge(peer, { multiaddrs });
}

/**
 * @param {any} peer
 * @param {any[]} dialCandidates
 */
async function dialDiscoveredPeerCandidates(peer, dialCandidates) {
	const errors = [];

	for (const candidate of dialCandidates) {
		try {
			return await libp2p.dial(candidate, { signal: createDialTimeoutSignal() });
		} catch (error) {
			errors.push({
				target: candidate.toString(),
				error: error instanceof Error ? error.message : String(error)
			});
		}
	}

	try {
		return await libp2p.dial(peer, { signal: createDialTimeoutSignal() });
	} catch (error) {
		errors.push({
			target: peer.toString(),
			error: error instanceof Error ? error.message : String(error)
		});
	}

	throw new Error(JSON.stringify(errors));
}

/**
 * @returns {AbortSignal | undefined}
 */
function createDialTimeoutSignal() {
	return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
		? AbortSignal.timeout(DISCOVERY_DIAL_TIMEOUT_MS)
		: undefined;
}

/**
 * @param {any[]} multiaddrs
 * @returns {any[]}
 */
function selectDiscoveredDialCandidates(multiaddrs) {
	return multiaddrs.filter(isBrowserDialableDiscoveredAddress).sort(rankDiscoveredDialCandidate);
}

/**
 * @param {any} addr
 * @returns {boolean}
 */
function isBrowserDialableDiscoveredAddress(addr) {
	const normalized = addr.toString().toLowerCase();
	const usesBrowserReachableTransport =
		normalized.includes('/ws') ||
		normalized.includes('/wss') ||
		normalized.includes('/webrtc') ||
		normalized.includes('/webrtc-direct');

	return (
		normalized.includes('/p2p/') &&
		usesBrowserReachableTransport &&
		(normalized.includes('/p2p-circuit') ||
			normalized.includes('/webrtc') ||
			normalized.includes('/webrtc-direct'))
	);
}

/**
 * @param {any} a
 * @param {any} b
 * @returns {number}
 */
function rankDiscoveredDialCandidate(a, b) {
	return rankDiscoveredDialCandidateAddress(a) - rankDiscoveredDialCandidateAddress(b);
}

/**
 * @param {any} addr
 * @returns {number}
 */
function rankDiscoveredDialCandidateAddress(addr) {
	const normalized = addr.toString().toLowerCase();
	const usesRelayCircuit = normalized.includes('/p2p-circuit');
	const usesWebSocket = normalized.includes('/ws') || normalized.includes('/wss');
	const usesWebRTC = normalized.includes('/webrtc');

	if (usesRelayCircuit && usesWebSocket && usesWebRTC) return 0;
	if (usesRelayCircuit && usesWebSocket && !usesWebRTC) return 1;
	if (normalized.includes('/webrtc-direct')) return 2;
	if (usesWebRTC) return 3;
	return 10;
}

/**
 * @param {any} addr
 * @returns {boolean}
 */
function isWebRTCDialCandidate(addr) {
	return addr.toString().toLowerCase().includes('/webrtc');
}

/**
 * @param {string} reason
 */
async function retryDiscoveredPeerDials(reason) {
	for (const [discoveredPeerId, peerInfo] of discoveredPeers) {
		await dialDiscoveredPeer(discoveredPeerId, peerInfo, reason);
	}
}

/**
 * @param {{ lastDialAttemptAt: number }} peerInfo
 * @returns {boolean}
 */
function shouldDialDiscoveredPeer(peerInfo) {
	if (!peerInfo.lastDialAttemptAt) return true;

	return Date.now() - peerInfo.lastDialAttemptAt >= DISCOVERY_DIAL_RETRY_COOLDOWN_MS;
}

/**
 * Attempt to connect to a remote peer via a multiaddress.
 *
 * @param {string} address
 * @returns {Promise<{ status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string }>}
 */
export async function connectToMultiaddr(address) {
	const normalizedAddress = address.trim();

	if (!normalizedAddress) {
		throw new Error('Please enter a multiaddress.');
	}

	if (!normalizedAddress.startsWith('/')) {
		throw new Error('A multiaddress must start with "/".');
	}

	if (!libp2p) {
		throw new Error('P2P is not initialized yet.');
	}

	let target;

	try {
		target = multiaddr(normalizedAddress);
	} catch (error) {
		throw new Error(
			`Invalid multiaddress: ${error instanceof Error ? error.message : String(error)}`
		);
	}

	if (target.getPeerId() == null) {
		throw new Error(
			'The multiaddress must include a peer id, for example ending with "/p2p/<peer-id>".'
		);
	}

	const connection = await libp2p.dial(target);
	const outcome = await waitForManualConnectionOutcome(connection);

	return {
		status: outcome.status,
		detail: outcome.detail,
		remotePeer: connection.remotePeer?.toString() ?? null,
		remoteAddr: connection.remoteAddr?.toString() ?? normalizedAddress
	};
}

/**
 * Watch a freshly-opened manual connection long enough to distinguish
 * a stable handshake from a remote peer that drops during follow-up setup.
 *
 * @param {any} connection
 * @returns {Promise<{ status: 'stable' | 'dropped', detail: string }>}
 */
function waitForManualConnectionOutcome(connection) {
	return new Promise((resolve) => {
		if (!libp2p) {
			resolve({
				status: 'dropped',
				detail: 'P2P node is no longer available.'
			});
			return;
		}

		let settled = false;

		/**
		 * @param {{ status: 'stable' | 'dropped', detail: string }} outcome
		 */
		const finish = (outcome) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeoutId);
			libp2p.removeEventListener('connection:close', handleConnectionClose);
			resolve(outcome);
		};

		/** @type {EventListener} */
		const handleConnectionClose = (event) => {
			const closedConnection = /** @type {CustomEvent<any>} */ (event).detail;

			if (closedConnection?.id !== connection.id) {
				return;
			}

			finish({
				status: 'dropped',
				detail:
					'Handshake succeeded, but the remote peer closed the connection during relay or protocol setup.'
			});
		};

		const timeoutId = setTimeout(() => {
			finish({
				status: 'stable',
				detail: `Connection stayed open for ${MANUAL_CONNECT_STABILIZATION_MS / 1000} seconds.`
			});
		}, MANUAL_CONNECT_STABILIZATION_MS);

		libp2p.addEventListener('connection:close', handleConnectionClose);
	});
}
