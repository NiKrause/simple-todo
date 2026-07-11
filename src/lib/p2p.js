import { get, writable } from 'svelte/store';

import { createLibp2p } from 'libp2p';
import { createHeliaLight } from 'helia';
import { withBitswap } from '@helia/bitswap';
import { withHTTP } from '@helia/http';
import { withLibp2p } from '@helia/libp2p';
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core';
import * as Block from 'multiformats/block';
import * as dagCbor from '@ipld/dag-cbor';
import * as dagJson from '@ipld/dag-json';
import * as json from 'multiformats/codecs/json';
import { CID } from 'multiformats/cid';
import { base58btc } from 'multiformats/bases/base58';
import { sha256, sha512 } from 'multiformats/hashes/sha2';
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
let defaultTodoDbAddress = '';
const ORBITDB_IDENTITY_STORAGE_KEY = 'simpleTodo.orbitdbIdentityId';
const ORBITDB_IDENTITY_EXCHANGE_TOPIC = 'simple-todo.orbitdb-identities';
const MANUAL_CONNECT_STABILIZATION_MS = 3_000;
const ORBITDB_IDENTITY_REPUBLISH_MS = 5_000;
const DISCOVERY_DIAL_PERIODIC_RETRY_MS = 2_000;
const DISCOVERY_DIAL_RETRY_COOLDOWN_MS = 5_000;
const DISCOVERY_DIAL_TIMEOUT_MS = 10_000;
/** @type {Map<string, { peer: any, multiaddrs: any[], isDialing: boolean, lastDialAttemptAt: number }>} */
const discoveredPeers = new Map();
/** @type {ReturnType<typeof setInterval> | null} */
let discoveryDialRetryInterval = null;
/** @type {ReturnType<typeof setInterval> | null} */
let orbitDBIdentityPublishInterval = null;

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
		helia = await createHeliaWithLibp2p(libp2p).start();
		console.log(`✅ Helia created`);

		// Create OrbitDB instance
		console.log('🛬 Creating OrbitDB instance...');
		orbitdb = await createOrbitDB({ ipfs: helia, id: getOrCreateOrbitDBIdentityId() });
		await setupOrbitDBIdentityExchange();
		todoDB = await openInitialTodoDatabase(options.todoDbAddress);

		console.log('✅ Database opened successfully with OrbitDBAccessController:', {
			address: todoDB.address,
			type: todoDB.type,
			accessController: todoDB.access
		});

		// Initialize database stores and actions
		await initializeDatabase(orbitdb, todoDB);

		// Mark initialization as complete
		initializationStore.set({ isInitializing: false, isInitialized: true, error: null });
		installPublicDiagnostics();
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
	initializationStore.set({ isInitializing: true, isInitialized: false, error: null });
	libp2pStore.set(null);
	peerIdStore.set(null);
	peerId = null;
	stopDiscoveryDialRetryInterval();
	await stopOrbitDBIdentityExchange();
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
 * distinct authors, while every peer opens the shared main tutorial database.
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
		publishOrbitDBIdentity,
		getWebRTCEnabled,
		setWebRTCEnabled,
		connectToMultiaddr
	};
}

async function setupOrbitDBIdentityExchange() {
	const pubsub = libp2p?.services?.pubsub;
	if (!pubsub || !orbitdb?.identity) return;

	await pubsub.subscribe(ORBITDB_IDENTITY_EXCHANGE_TOPIC);
	pubsub.addEventListener('message', handleOrbitDBIdentityMessage);
	libp2p.addEventListener('connection:open', handleOrbitDBIdentityConnectionOpen);

	await publishOrbitDBIdentity();
	stopOrbitDBIdentityPublishInterval();
	orbitDBIdentityPublishInterval = setInterval(() => {
		void publishOrbitDBIdentity().catch((error) => {
			console.warn(
				'Failed to publish OrbitDB identity:',
				error instanceof Error ? error.message : String(error)
			);
		});
	}, ORBITDB_IDENTITY_REPUBLISH_MS);
}

async function stopOrbitDBIdentityExchange() {
	stopOrbitDBIdentityPublishInterval();

	const pubsub = libp2p?.services?.pubsub;
	pubsub?.removeEventListener?.('message', handleOrbitDBIdentityMessage);
	libp2p?.removeEventListener?.('connection:open', handleOrbitDBIdentityConnectionOpen);

	try {
		await pubsub?.unsubscribe?.(ORBITDB_IDENTITY_EXCHANGE_TOPIC);
	} catch {
		// ignore unsubscribe failures during shutdown
	}
}

function stopOrbitDBIdentityPublishInterval() {
	if (!orbitDBIdentityPublishInterval) return;

	clearInterval(orbitDBIdentityPublishInterval);
	orbitDBIdentityPublishInterval = null;
}

function handleOrbitDBIdentityConnectionOpen() {
	void publishOrbitDBIdentity().catch((error) => {
		console.warn(
			'Failed to publish OrbitDB identity after connection opened:',
			error instanceof Error ? error.message : String(error)
		);
	});
}

/**
 * @param {CustomEvent<{ topic?: string, data?: Uint8Array }>} event
 */
async function handleOrbitDBIdentityMessage(event) {
	if (event.detail?.topic !== ORBITDB_IDENTITY_EXCHANGE_TOPIC || !event.detail.data) return;

	try {
		const payload = JSON.parse(new TextDecoder().decode(event.detail.data));
		await importOrbitDBIdentityBlock(payload);
	} catch (error) {
		console.warn(
			'Failed to import OrbitDB identity from pubsub:',
			error instanceof Error ? error.message : String(error)
		);
	}
}

export async function publishOrbitDBIdentity() {
	const pubsub = libp2p?.services?.pubsub;
	const identity = orbitdb?.identity;

	if (!pubsub || !identity?.hash || !identity?.bytes) return false;

	const payload = {
		peerId,
		hash: identity.hash,
		bytes: Array.from(identity.bytes)
	};
	const bytes = new TextEncoder().encode(JSON.stringify(payload));
	await pubsub.publish(ORBITDB_IDENTITY_EXCHANGE_TOPIC, bytes);
	return true;
}

/**
 * @param {{ hash?: unknown, bytes?: unknown }} payload
 */
async function importOrbitDBIdentityBlock(payload) {
	if (!helia?.blockstore || typeof payload?.hash !== 'string' || !Array.isArray(payload.bytes)) {
		return false;
	}

	const cid = CID.parse(payload.hash, base58btc);
	if (await helia.blockstore.has(cid)) {
		return true;
	}

	await helia.blockstore.put(cid, toUint8Array(payload.bytes));
	return true;
}

/**
 * @param {string} dbAddress
 * @returns {Promise<Array<{ hash: string, bytes: number[] }>>}
 */
export async function exportOrbitDBAddressBlocks(dbAddress) {
	if (!helia?.blockstore || typeof dbAddress !== 'string') return [];

	/** @type {Array<{ hash: string, bytes: number[] }>} */
	const blocks = [];
	const seen = new Set();
	const dbHash = getOrbitDBAddressHash(dbAddress);
	const manifestBlock = await exportLocalBlock(dbHash, seen);
	if (!manifestBlock) return blocks;

	blocks.push(manifestBlock);

	try {
		const { value } = await Block.decode({
			bytes: toUint8Array(manifestBlock.bytes),
			codec: dagCbor,
			hasher: sha256
		});
		const manifest = /** @type {{ accessController?: unknown }} */ (value);
		const accessControllerHash = getIpfsAddressHash(manifest?.accessController);
		const accessControllerBlock = await exportLocalBlock(accessControllerHash, seen);
		if (accessControllerBlock) {
			blocks.push(accessControllerBlock);
		}
	} catch {
		// The manifest block itself is still useful even if we cannot inspect it.
	}

	return blocks;
}

/**
 * @param {unknown} blocks
 * @returns {Promise<number>}
 */
export async function importOrbitDBAddressBlocks(blocks) {
	if (!helia?.blockstore || !Array.isArray(blocks)) return 0;

	let imported = 0;
	for (const block of blocks) {
		if (typeof block?.hash !== 'string' || !Array.isArray(block.bytes)) continue;

		const cid = CID.parse(block.hash, base58btc);
		if (await helia.blockstore.has(cid)) continue;

		await helia.blockstore.put(cid, toUint8Array(block.bytes));
		imported += 1;
	}

	return imported;
}

/**
 * @param {string | null} hash
 * @param {Set<string>} seen
 */
async function exportLocalBlock(hash, seen) {
	if (!hash || seen.has(hash)) return null;

	const cid = CID.parse(hash, base58btc);
	if (!(await helia.blockstore.has(cid))) return null;

	const bytes = await collectUint8Array(await helia.blockstore.get(cid));
	seen.add(hash);
	return {
		hash,
		bytes: Array.from(bytes)
	};
}

/**
 * @param {unknown} value
 * @returns {Promise<Uint8Array>}
 */
async function collectUint8Array(value) {
	const iterable = /** @type {any} */ (value);
	if (iterable && typeof iterable[Symbol.asyncIterator] === 'function') {
		const chunks = [];
		for await (const chunk of iterable) {
			chunks.push(toUint8Array(chunk));
		}
		return concatUint8Arrays(chunks);
	}

	if (
		iterable &&
		typeof iterable[Symbol.iterator] === 'function' &&
		!(value instanceof Uint8Array)
	) {
		const chunks = [];
		for (const chunk of iterable) {
			chunks.push(toUint8Array(chunk));
		}
		if (chunks.length > 0 && chunks.every((chunk) => chunk.byteLength > 0)) {
			return concatUint8Arrays(chunks);
		}
	}

	return toUint8Array(value);
}

/**
 * @param {Uint8Array[]} chunks
 */
function concatUint8Arrays(chunks) {
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

/**
 * @param {unknown} value
 * @returns {Uint8Array}
 */
function toUint8Array(value) {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (Array.isArray(value)) return Uint8Array.from(value);
	const bytesLike = /** @type {any} */ (value);
	if (typeof bytesLike?.subarray === 'function') return toUint8Array(bytesLike.subarray());
	if (typeof bytesLike?.slice === 'function') return toUint8Array(bytesLike.slice());
	return new Uint8Array();
}

/**
 * @param {string} address
 */
function getOrbitDBAddressHash(address) {
	const parts = address.split('/').filter(Boolean);
	return parts[0] === 'orbitdb' ? parts[1] || null : null;
}

/**
 * @param {unknown} address
 */
function getIpfsAddressHash(address) {
	if (typeof address !== 'string') return null;
	const parts = address.split('/').filter(Boolean);
	return parts[0] === 'ipfs' ? parts[1] || null : null;
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
