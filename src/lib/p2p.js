import { get, writable } from 'svelte/store';

import { createLibp2p } from 'libp2p';
import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withHTTP } from '@helia/http';
import { withLibp2p } from '@helia/libp2p';
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core';
import * as dagCbor from '@ipld/dag-cbor';
import * as dagJson from '@ipld/dag-json';
import * as json from 'multiformats/codecs/json';
import { sha512 } from 'multiformats/hashes/sha2';
import { multiaddr } from '@multiformats/multiaddr';
import { createLibp2pConfig } from './libp2p-config.js';
import { initializeDatabase, todoDBAddressStore, todosStore } from './db-actions.js';
import { getWebRTCEnabled, setWebRTCEnabled, webrtcEnabledStore } from './webrtc-settings.js';
import { getDefaultTodoDatabaseName } from './default-todo-database.js';
import { normalizeDiscoveredMultiaddrs } from './multiaddr-utils.js';

export { setWebRTCEnabled, webrtcEnabledStore };

// Export libp2p instance for plugins
export const libp2pStore = writable(/** @type {any} */ (null));
export const peerIdStore = writable(/** @type {string | null} */ (null));

const INITIALIZATION_STEP_DEFINITIONS = [
	{
		label: 'Network config',
		description:
			'Validates the configured browser-reachable relay addresses and prepares the libp2p transports and services.'
	},
	{
		label: 'libp2p',
		description:
			'Creates and starts the libp2p node, including its peer identity, discovery, relay, WebSocket and WebRTC support.'
	},
	{
		label: 'Helia',
		description:
			'Starts the Helia IPFS node on top of libp2p and enables block exchange and HTTP retrieval.'
	},
	{
		label: 'OrbitDB',
		description:
			'Loads or creates the persistent OrbitDB identity and initializes OrbitDB using the Helia node.'
	},
	{
		label: 'Database + sync',
		description:
			'Opens the shared todo database, loads its local operation log and starts OrbitDB pubsub synchronization.'
	},
	{
		label: 'Local todos',
		description:
			'Connects the local todo store and starts hydrating it from OrbitDB in the background without blocking the application.'
	}
];

/**
 * @typedef {'pending' | 'active' | 'complete' | 'error'} InitializationStepStatus
 * @typedef {{ label: string, description: string, status: InitializationStepStatus }} InitializationStep
 */

/** @param {number} [activeIndex=-1] */
function createInitializationSteps(activeIndex = -1) {
	return INITIALIZATION_STEP_DEFINITIONS.map(({ label, description }, index) => ({
		label,
		description,
		status: /** @type {InitializationStepStatus} */ (
			index < activeIndex ? 'complete' : index === activeIndex ? 'active' : 'pending'
		)
	}));
}

// Add initialization state store
export const initializationStore = writable(
	/** @type {{ isInitializing: boolean, isInitialized: boolean, error: string | null, steps: InitializationStep[] }} */ ({
		isInitializing: false,
		isInitialized: false,
		error: null,
		steps: createInitializationSteps()
	})
);

/** @param {number} activeIndex */
function setInitializationProgress(activeIndex) {
	initializationStore.set({
		isInitializing: true,
		isInitialized: false,
		error: null,
		steps: createInitializationSteps(activeIndex)
	});
}

let libp2p = /** @type {any} */ (null);
let helia = /** @type {any} */ (null);
let orbitdb = /** @type {any} */ (null);

let peerId = /** @type {string | null} */ (null);
let todoDB = /** @type {any} */ (null);
let defaultTodoDbAddress = '';
const ORBITDB_IDENTITY_STORAGE_KEY = 'simpleTodo.orbitdbIdentityId';
const MANUAL_CONNECT_STABILIZATION_MS = 3_000;
const DISCOVERY_DIAL_PERIODIC_RETRY_MS = 2_000;
const DISCOVERY_DIAL_RETRY_COOLDOWN_MS = 5_000;
const DISCOVERY_DIAL_TIMEOUT_MS = 10_000;
/** @type {Map<string, { peer: any, multiaddrs: any[], isDialing: boolean, lastDialAttemptAt: number }>} */
const discoveredPeers = new Map();
/** @type {ReturnType<typeof setInterval> | null} */
let discoveryDialRetryInterval = null;
/** @type {ReturnType<typeof setInterval> | null} */

/**
 * @param {any} libp2pNode
 * @returns {any}
 */
function createHeliaWithLibp2p(libp2pNode) {
	return withBitswap(
		withLibp2p(
			withHTTP(
				createHeliaLight({
					codecs: [dagCbor, dagJson, json],
					hashers: [sha512]
				})
			),
			libp2pNode
		)
	);
}

/**
 * Initialize the P2P network after user consent
 * This function should be called only after the user has accepted the consent modal
 */
export async function initializeP2P(options = /** @type {{ todoDbAddress?: string }} */ ({})) {
	console.log('🚀 Starting P2P initialization after user consent...');

	try {
		// Set initialization state
		setInitializationProgress(0);

		// Create libp2p configuration and node
		const config = await createLibp2pConfig();
		setInitializationProgress(1);
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
		setInitializationProgress(2);
		helia = await createHeliaWithLibp2p(libp2p).start();
		console.log(`✅ Helia created`);

		// Create OrbitDB instance
		setInitializationProgress(3);
		console.log('🛬 Creating OrbitDB instance...');
		orbitdb = await createOrbitDB({ ipfs: helia, id: getOrCreateOrbitDBIdentityId() });
		setInitializationProgress(4);
		todoDB = await openInitialTodoDatabase(options.todoDbAddress);

		console.log('✅ Database opened successfully with OrbitDBAccessController:', {
			address: todoDB.address,
			type: todoDB.type,
			accessController: todoDB.access
		});

		// Initialize database stores and actions
		setInitializationProgress(5);
		await initializeDatabase(orbitdb, todoDB);

		// Mark initialization as complete
		initializationStore.set({
			isInitializing: false,
			isInitialized: true,
			error: null,
			steps: createInitializationSteps(INITIALIZATION_STEP_DEFINITIONS.length)
		});
		installPublicDiagnostics();
		installE2ETestHooks();
		console.log('🎉 P2P initialization completed successfully!');
	} catch (error) {
		console.error('❌ Failed to initialize P2P:', error);
		initializationStore.set({
			isInitializing: false,
			isInitialized: false,
			error: error instanceof Error ? error.message : String(error),
			steps: []
		});
		throw error;
	}
}

/**
 * Restart libp2p, Helia and OrbitDB with the current transport settings.
 * The active Todo DB address is preserved when one is available.
 */
export async function restartP2P() {
	const activeTodoDbAddress = get(todoDBAddressStore);
	const shouldPreserveActiveTodoDb =
		Boolean(activeTodoDbAddress) && activeTodoDbAddress !== defaultTodoDbAddress;

	await stopP2P();
	await initializeP2P({ todoDbAddress: shouldPreserveActiveTodoDb ? activeTodoDbAddress : '' });
}

async function stopP2P() {
	setInitializationProgress(0);
	libp2pStore.set(null);
	peerIdStore.set(null);
	peerId = null;
	stopDiscoveryDialRetryInterval();
	discoveredPeers.clear();

	const resources = [todoDB, orbitdb, helia, libp2p];
	todoDB = null;
	orbitdb = null;
	helia = null;
	libp2p = null;

	await Promise.allSettled(resources.map((resource) => resource?.stop?.() ?? resource?.close?.()));

	todosStore.set([]);
}

/**
 * @param {string | undefined} address
 */
async function openInitialTodoDatabase(address) {
	const normalizedAddress = address?.trim() ?? '';

	if (normalizedAddress.startsWith('/orbitdb/')) {
		return orbitdb.open(normalizedAddress, {
			type: 'keyvalue',
			sync: true
		});
	}

	const defaultTodoDB = await orbitdb.open(getDefaultTodoDatabaseName(), {
		type: 'keyvalue', //Stores data as key-value pairs supports basic operations: put(), get(), delete()
		create: true, // Allows the database to be created if it doesn't exist
		sync: true, // Enables automatic synchronization with other peers
		AccessController: IPFSAccessController({ write: ['*'] }) //defines who can write to the database, ["*"] is a wildcard that allows all peers to write to the database, This creates a fully collaborative environment where any peer can add/edit TODOs
	});

	defaultTodoDbAddress = defaultTodoDB.address?.toString?.() ?? '';
	return defaultTodoDB;
}

/**
 * Keep a browser-profile identity id so entries from separate peers retain
 * distinct authors, while every peer opens the shared default database.
 */
function getOrCreateOrbitDBIdentityId() {
	if (typeof localStorage === 'undefined') {
		return createOrbitDBIdentityId();
	}

	const existingIdentityId = localStorage.getItem(ORBITDB_IDENTITY_STORAGE_KEY);
	if (existingIdentityId) {
		return existingIdentityId;
	}

	const identityId = createOrbitDBIdentityId();
	localStorage.setItem(ORBITDB_IDENTITY_STORAGE_KEY, identityId);
	return identityId;
}

function createOrbitDBIdentityId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `simple-todo-${crypto.randomUUID()}`;
	}

	return `simple-todo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getReadOnlyDiagnostics() {
	return {
		getPeerId: () => peerId,
		getDatabaseAddress: () => get(todoDBAddressStore),
		getMultiaddrs: () => {
			const ownAddrs =
				libp2p?.getMultiaddrs?.().map((/** @type {any} */ addr) => addr.toString()) ?? [];
			const peerStoreAddrs =
				libp2p?.peerStore?.addressBook
					?.get?.(libp2p?.peerId)
					?.multiaddrs?.map((/** @type {any} */ addr) => addr.toString()) ?? [];
			return Array.from(new Set([...ownAddrs, ...peerStoreAddrs]));
		},
		getConnections: () =>
			libp2p?.getConnections?.().map((/** @type {any} */ connection) => ({
				remotePeer: connection.remotePeer?.toString() ?? null,
				remoteAddr: connection.remoteAddr?.toString() ?? null
			})) ?? []
	};
}

function installPublicDiagnostics() {
	if (typeof window === 'undefined') return;

	/** @type {Window & typeof globalThis & { __simpleTodoDiagnostics?: Record<string, unknown> }} */ (
		window
	).__simpleTodoDiagnostics = Object.freeze(getReadOnlyDiagnostics());
}

function installE2ETestHooks() {
	if (typeof window === 'undefined' || import.meta.env.VITE_E2E !== 'true') return;

	const diagnostics = getReadOnlyDiagnostics();

	/** @type {Window & typeof globalThis & { __simpleTodoE2E?: Record<string, unknown> }} */ (
		window
	).__simpleTodoE2E = {
		...diagnostics,
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
		getOrbitDBIdentity: () =>
			orbitdb?.identity
				? {
						id: orbitdb.identity.id ?? null,
						publicKey: orbitdb.identity.publicKey ?? null,
						hash: orbitdb.identity.hash ?? null,
						type: orbitdb.identity.type ?? null
					}
				: null,
		hasOrbitDBIdentity: async (/** @type {unknown} */ hash) =>
			typeof hash === 'string' && Boolean(await orbitdb?.identities?.getIdentity?.(hash)),
		getWebRTCEnabled,
		setWebRTCEnabled,
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
	startDiscoveryDialRetryInterval();
}

function startDiscoveryDialRetryInterval() {
	stopDiscoveryDialRetryInterval();
	discoveryDialRetryInterval = setInterval(() => {
		void retryDiscoveredPeerDials('periodic:discovery-retry').catch((error) => {
			console.warn(
				'Failed to retry discovered peer dials:',
				error instanceof Error ? error.message : String(error)
			);
		});
	}, DISCOVERY_DIAL_PERIODIC_RETRY_MS);
}

function stopDiscoveryDialRetryInterval() {
	if (!discoveryDialRetryInterval) return;

	clearInterval(discoveryDialRetryInterval);
	discoveryDialRetryInterval = null;
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
	return dialDiscoveredPeerWithOptions(discoveredPeerId, peerInfo, reason, {});
}

/**
 * @param {string} discoveredPeerId
 * @param {{ peer: any, multiaddrs: any[], isDialing: boolean, lastDialAttemptAt: number }} peerInfo
 * @param {string} reason
 * @param {{ force?: boolean }} options
 */
async function dialDiscoveredPeerWithOptions(
	discoveredPeerId,
	peerInfo,
	reason,
	{ force = false } = {}
) {
	if (!libp2p) return;

	if (peerInfo.isDialing) {
		return;
	}

	if (!force && !shouldDialDiscoveredPeer(peerInfo)) {
		return;
	}

	const dialCandidates = selectDiscoveredDialCandidates(peerInfo.multiaddrs);
	const existingConnections = libp2p.getConnections(peerInfo.peer) ?? [];
	const shouldAttemptWebRTCUpgrade =
		getWebRTCEnabled() &&
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
	return connections.some(isWebRTCConnection);
}

/**
 * @param {any} connection
 * @returns {boolean}
 */
function isWebRTCConnection(connection) {
	return connection.remoteAddr?.toString().toLowerCase().includes('/webrtc') ?? false;
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

	if (!getWebRTCEnabled()) {
		throw new Error(JSON.stringify(errors));
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
	const candidates = multiaddrs.filter(isBrowserDialableDiscoveredAddress);

	if (!getWebRTCEnabled()) {
		return candidates
			.filter((addr) => !isWebRTCDialCandidate(addr))
			.sort(rankDiscoveredDialCandidate);
	}

	return candidates.sort(rankDiscoveredDialCandidate);
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

	return normalized.includes('/p2p/') && usesBrowserReachableTransport;
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
	if (usesWebSocket) return 4;
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
async function retryDiscoveredPeerDials(reason, { force = false } = {}) {
	for (const [discoveredPeerId, peerInfo] of discoveredPeers) {
		await dialDiscoveredPeerWithOptions(discoveredPeerId, peerInfo, reason, { force });
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

	if (extractPeerIdFromMultiaddr(normalizedAddress) == null) {
		throw new Error(
			'The multiaddress must include a peer id, for example ending with "/p2p/<peer-id>".'
		);
	}

	if (!getWebRTCEnabled() && normalizedAddress.toLowerCase().includes('/webrtc')) {
		throw new Error('WebRTC is disabled. Use a relay circuit multiaddress instead.');
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
 * @param {string} addr
 * @returns {string | null}
 */
function extractPeerIdFromMultiaddr(addr) {
	const parts = addr.split('/').filter(Boolean);
	const peerIndex = parts.findIndex((part) => part === 'p2p' || part === 'ipfs');
	return peerIndex >= 0 ? parts[peerIndex + 1] || null : null;
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
