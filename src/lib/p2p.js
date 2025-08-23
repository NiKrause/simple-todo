import { writable } from 'svelte/store';

import { createLibp2p } from 'libp2p';
import { createHelia } from 'helia';
import { createOrbitDB, IPFSAccessController } from '@orbitdb/core';
import { createLibp2pConfig, RELAY_BOOTSTRAP_ADDR } from './libp2p-config.js';
import { initializeDatabase } from './db-actions.js';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';

// Export libp2p instance for plugins
export const libp2pStore = writable(null);
export const peerIdStore = writable(null);

// Add initialization state store
export const initializationStore = writable({
	isInitializing: false,
	isInitialized: false,
	error: null
});

let libp2p = null;
let helia = null;
let orbitdb = null;

let peerId = null;
let todoDB = null;

/**
 * Initialize the P2P network after user consent
 * This function should be called only after the user has accepted the consent modal
 * @param {Object} preferences - Network preferences from user consent
 * @param {boolean} preferences.enablePersistentStorage - Whether to enable persistent storage
 * @param {boolean} preferences.enableNetworkConnection - Whether to enable network connection
 * @param {boolean} preferences.enablePeerConnections - Whether to enable direct peer connections
 */
export async function initializeP2P(preferences = {}) {
	const {
		enablePersistentStorage = true,
		enableNetworkConnection = true,
		enablePeerConnections = true
	} = preferences;

	console.log('🚀 Starting P2P initialization after user consent...', {
		enablePersistentStorage,
		enableNetworkConnection,
		enablePeerConnections
	});

	// Add detailed debugging for each choice
	console.log('🔧 DEBUG: Storage Configuration:', {
		persistent: enablePersistentStorage,
		willUsePersistentStorage: enablePersistentStorage ? 'YES - Using LevelDB for blocks/data' : 'NO - Using in-memory storage only'
	});

	console.log('🔧 DEBUG: Network Configuration:', {
		networkConnection: enableNetworkConnection,
		willBootstrapToRelay: enableNetworkConnection ? 'YES - Will connect to relay bootstrap nodes' : 'NO - No relay bootstrap',
		relayAddresses: enableNetworkConnection ? RELAY_BOOTSTRAP_ADDR : 'N/A'
	});

	console.log('🔧 DEBUG: Peer Discovery Configuration:', {
		peerConnections: enablePeerConnections,
		willUsePubsubDiscovery: enablePeerConnections ? 'YES - Using pubsub peer discovery' : 'NO - No peer discovery',
		pubsubTopics: enablePeerConnections ? 'todo._peer-discovery._p2p._pubsub' : 'N/A'
	});

	try {
		// Set initialization state
		initializationStore.set({ isInitializing: true, isInitialized: false, error: null });

		// Create libp2p configuration and node with network and peer connection preferences
		const config = await createLibp2pConfig({ 
			enablePeerConnections, 
			enableNetworkConnection 
		});
		libp2p = await createLibp2p(config);
		libp2pStore.set(libp2p); // Make available to plugins
		console.log(`✅ libp2p node created with network connection: ${enableNetworkConnection ? 'enabled' : 'disabled'}, peer connections: ${enablePeerConnections ? 'enabled' : 'disabled'}`);

		// Get and set peer ID
		peerId = libp2p.peerId.toString();
		console.log(`✅ peerId is ${peerId}`);
		peerIdStore.set(peerId);

		// Create Helia (IPFS) instance
		let heliaConfig = { libp2p };

		if (enablePersistentStorage) {
			console.log('🗄️ Initializing Helia with persistent storage...');
			const blockstore = new LevelBlockstore('./helia-blocks');
			const datastore = new LevelDatastore('./helia-data');
			heliaConfig = { libp2p, blockstore, datastore };
		} else {
			console.log('💾 Initializing Helia with in-memory storage...');
		}

		helia = await createHelia(heliaConfig);
		console.log(`✅ Helia created with ${enablePersistentStorage ? 'persistent' : 'in-memory'} storage`);

		// Create OrbitDB instance
		console.log('🛬 Creating OrbitDB instance...');
		orbitdb = await createOrbitDB({ 
			ipfs: helia, 
			id: 'simple-todo-app',
			// Pass storage preferences to OrbitDB if needed
		});
		
		todoDB = await orbitdb.open('simple-todos', {
			type: 'keyvalue', //Stores data as key-value pairs supports basic operations: put(), get(), delete()
			create: true, // Allows the database to be created if it doesn't exist
			sync: enablePeerConnections, // Only enable sync if peer connections are allowed
			AccessController: IPFSAccessController({ write: ['*'] }) //defines who can write to the database, ["*"] is a wildcard that allows all peers to write to the database, This creates a fully collaborative environment where any peer can add/edit TODOs
		});

		console.log('✅ Database opened successfully with OrbitDBAccessController:', {
			address: todoDB.address,
			type: todoDB.type,
			accessController: todoDB.access,
			syncEnabled: enablePeerConnections,
			networkConnectionEnabled: enableNetworkConnection
		});

		// Initialize database stores and actions
		await initializeDatabase(orbitdb, todoDB);

		// Mark initialization as complete
		initializationStore.set({ isInitializing: false, isInitialized: true, error: null });
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
