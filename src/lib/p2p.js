import { writable } from 'svelte/store';

import { createLibp2p } from 'libp2p';
import { createHelia } from 'helia';
import { createOrbitDB, OrbitDBAccessController, MemoryStorage } from '@orbitdb/core';
import SimpleEncryption from '@orbitdb/simple-encryption';
import { createLibp2pConfig } from './libp2p-config.js';
import { initializeDatabase } from './db-actions.js';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { systemToasts } from './toast-store.js';

// Export libp2p instance for plugins
export const libp2pStore = writable(null);
export const peerIdStore = writable(null);

// Export OrbitDB instance for backup/restore operations
export const orbitDBStore = writable(null);

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
let currentIdentity = null;

/**
 * Open or create a todo list database
 * @param {string} todoListName - Name of the todo list (default: 'projects')
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether to enable encryption
 * @param {string} encryptionPassword - Password for encryption (required if enableEncryption is true)
 * @returns {Promise<Object>} The opened database
 */
export async function openTodoList(
	todoListName = 'projects',
	preferences = {},
	enableEncryption = false,
	encryptionPassword = null
) {
	if (!orbitdb) {
		throw new Error('OrbitDB instance not initialized. Please initialize P2P first.');
	}

	if (!currentIdentity) {
		currentIdentity = orbitdb.identity;
	}

	// Create database name: identityId + "_" + todoListName
	const identityId = currentIdentity.id;
	const dbName = `${identityId}_${todoListName}`;
	console.log(`📂 Opening todo list database: ${dbName} (display name: ${todoListName})`);

	// Close existing database if open
	if (todoDB) {
		console.log('🔒 Closing existing database...');
		await todoDB.close();
		todoDB = null;
	}

	const {
		enablePersistentStorage = true,
		enableNetworkConnection = true,
		// eslint-disable-next-line no-unused-vars
		enablePeerConnections: _enablePeerConnections = true
	} = preferences;

	// Set up encryption if enabled
	let encryption = null;
	if (enableEncryption && encryptionPassword) {
		console.log('🔐 Setting up encryption for database...');
		const dataEncryption = await SimpleEncryption({ password: encryptionPassword });
		const replicationEncryption = await SimpleEncryption({ password: encryptionPassword });
		encryption = { data: dataEncryption, replication: replicationEncryption };
	}

	// Set up access controller - only allow the current identity to write
	const accessController = OrbitDBAccessController({
		write: [identityId]
	});

	const headsStorage = await MemoryStorage();
	const entryStorage = await MemoryStorage();

	// Open the database
	if (!enablePersistentStorage && !enableNetworkConnection) {
		// In-memory storage only
		todoDB = await orbitdb.open(dbName, {
			type: 'keyvalue',
			create: true,
			headsStorage,
			entryStorage,
			AccessController: accessController,
			encryption
		});
	} else {
		todoDB = await orbitdb.open(dbName, {
			type: 'keyvalue',
			create: true,
			sync: enableNetworkConnection,
			AccessController: accessController,
			encryption
		});
	}

	console.log('🔍 TodoDB records:', (await todoDB.all()).length);
	console.log('✅ Database opened successfully:', todoDB);

	// Initialize database stores and actions
	await initializeDatabase(orbitdb, todoDB, preferences);

	return todoDB;
}

/**
 * Open a database by its full database name (identityId_displayName)
 * @param {string} dbName - The full database name (e.g., "c852aa330a611daf24dd8f039d5990f96a4a498f5_orbitdb-storacha-bridge")
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether to enable encryption
 * @param {string} encryptionPassword - Password for encryption (required if enableEncryption is true)
 * @returns {Promise<Object>} The opened database
 */
export async function openDatabaseByName(
	dbName,
	preferences = {},
	enableEncryption = false,
	encryptionPassword = null
) {
	if (!orbitdb) {
		throw new Error('OrbitDB instance not initialized. Please initialize P2P first.');
	}

	if (!currentIdentity) {
		currentIdentity = orbitdb.identity;
	}

	const currentInstanceIdentity = currentIdentity?.id || orbitdb.identity?.id;
	console.log(`📂 Opening database by name: ${dbName}`);
	console.log('🔑 Current OrbitDB instance identity:', currentInstanceIdentity);

	// Extract identity from dbName (part before first underscore)
	let dbNameIdentity = null;
	if (dbName && dbName.includes('_')) {
		const underscoreIndex = dbName.indexOf('_');
		if (underscoreIndex > 0) {
			dbNameIdentity = dbName.substring(0, underscoreIndex);
		}
	}

	const isOurIdentity = dbNameIdentity === currentInstanceIdentity;
	console.log('🔧 Database identity (from name):', dbNameIdentity);
	console.log('🔧 Is our identity?', isOurIdentity);

	// Close existing database if open
	if (todoDB) {
		console.log('🔒 Closing existing database...');
		await todoDB.close();
		todoDB = null;
	}

	// If it's NOT our identity, use NO options (like openDatabaseByAddress)
	// Everything should be read from the database manifest
	if (!isOurIdentity && dbNameIdentity) {
		console.log(
			'🔧 Opening database from different identity - using NO options (all config from manifest)'
		);

		try {
			// Open with NO options - OrbitDB will read everything from the manifest
			todoDB = await orbitdb.open(dbName);

			console.log('🔍 TodoDB records:', (await todoDB.all()).length);
			console.log('✅ Database opened successfully by name:', todoDB);
			console.log('🔧 Database address after open:', todoDB.address);
			console.log('🔧 Database name:', todoDB.name);

			// Initialize database stores and actions
			await initializeDatabase(orbitdb, todoDB, preferences);

			return todoDB;
		} catch (error) {
			console.error('❌ Error opening database by name (different identity):', error);
			throw error;
		}
	}

	// If it's our identity, we can use options (but still minimal)
	const {
		enablePersistentStorage = true,
		enableNetworkConnection = true,
		// eslint-disable-next-line no-unused-vars
		enablePeerConnections: _enablePeerConnections = true
	} = preferences;

	// Set up encryption if enabled
	let encryption = null;
	if (enableEncryption && encryptionPassword) {
		console.log('🔐 Setting up encryption for database...');
		const dataEncryption = await SimpleEncryption({ password: encryptionPassword });
		const replicationEncryption = await SimpleEncryption({ password: encryptionPassword });
		encryption = { data: dataEncryption, replication: replicationEncryption };
	}

	// Try to open the database by name (our identity)
	// Note: For our own databases, we can provide options
	try {
		if (!enablePersistentStorage && !enableNetworkConnection) {
			// In-memory storage only
			todoDB = await orbitdb.open(dbName, {
				type: 'keyvalue',
				create: false, // Don't create if it doesn't exist
				sync: false,
				encryption
			});
		} else {
			todoDB = await orbitdb.open(dbName, {
				type: 'keyvalue',
				create: false, // Don't create if it doesn't exist
				sync: enableNetworkConnection,
				encryption
			});
		}

		console.log('🔍 TodoDB records:', (await todoDB.all()).length);
		console.log('✅ Database opened successfully by name:', todoDB);

		// Initialize database stores and actions
		await initializeDatabase(orbitdb, todoDB, preferences);

		return todoDB;
	} catch (error) {
		console.error('❌ Error opening database by name:', error);
		throw error;
	}
}

/**
 * Open a database by its address (hash)
 * @param {string} dbAddress - The database address/hash (e.g., "031d947594b8d02f69041280fd5bdd6ff6a07ec3130e075b86893179c543e3e305_simpletodo")
 * @param {Object} preferences - Network preferences
 * @param {boolean} enableEncryption - Whether to enable encryption
 * @param {string} encryptionPassword - Password for encryption (required if enableEncryption is true)
 * @returns {Promise<Object>} The opened database
 */
export async function openDatabaseByAddress(
	dbAddress,
	preferences = {},
	// eslint-disable-next-line no-unused-vars
	enableEncryption = false,
	// eslint-disable-next-line no-unused-vars
	encryptionPassword = null
) {
	if (!orbitdb) {
		throw new Error('OrbitDB instance not initialized. Please initialize P2P first.');
	}

	// Initialize currentIdentity only if it doesn't exist (first time)
	// But don't modify it after opening databases - preserve the original identity
	if (!currentIdentity) {
		currentIdentity = orbitdb.identity;
	}

	// Don't modify currentIdentity - preserve the original identity
	// The database's access controller is read from the manifest, not set by us
	const currentInstanceIdentity = currentIdentity?.id || orbitdb.identity?.id;
	console.log(`📂 Opening database by address: ${dbAddress}`);
	console.log('🔑 Current OrbitDB instance identity:', currentInstanceIdentity);

	// Close existing database if open
	if (todoDB) {
		console.log('🔒 Closing existing database...');
		await todoDB.close();
		todoDB = null;
	}

	// Preferences and encryption parameters are intentionally unused
	// All configuration comes from the database manifest stored at the address
	// This function signature is kept for API consistency with other open functions

	// Open the database by address only - NO OPTIONS AT ALL
	// Everything (type, access controller, encryption, etc.) is already defined in the database manifest
	// The manifest is stored at the database address and contains all configuration
	try {
		// IMPORTANT: When opening by address, we must NOT provide ANY options
		// OrbitDB will read everything from the database manifest automatically:
		// - Database type (keyvalue, docstore, etc.)
		// - Access controller address and configuration
		// - Encryption settings (if any)
		// - All other settings
		//
		// Providing ANY options (type, create, sync, AccessController, encryption, etc.)
		// would override the manifest settings and potentially create a new access controller

		console.log('🔧 Opening database by address with NO options (all config from manifest)');
		console.log('🔧 Database address:', dbAddress);
		console.log('🔑 Current OrbitDB instance identity:', currentInstanceIdentity);

		// Open with NO options - OrbitDB will read everything from the manifest
		// The manifest contains:
		// 1. Database type
		// 2. Access controller address (points to the original access controller)
		// 3. All other configuration
		// By not providing any options, OrbitDB will use the original configuration
		todoDB = await orbitdb.open(dbAddress);

		console.log('🔍 TodoDB records:', (await todoDB.all()).length);
		console.log('✅ Database opened successfully by address:', todoDB);
		console.log('🔧 Database address after open:', todoDB.address);
		console.log('🔧 Database name:', todoDB.name);

		// Extract the database's original identity from its name
		const dbNameIdentity = todoDB.name?.split('_')[0];
		console.log('🔧 Database original identity (from db name):', dbNameIdentity);
		console.log('🔧 Current instance identity:', currentInstanceIdentity);

		if (dbNameIdentity && dbNameIdentity !== currentInstanceIdentity) {
			console.log(
				'ℹ️  Database belongs to different identity - opening in read/write mode based on access controller permissions'
			);
		}

		console.log('🔧 Access controller address:', todoDB.access?.address);
		console.log('🔧 Access controller write permissions:', todoDB.access?.write);

		// Verify identity wasn't changed
		const identityAfterOpen = currentIdentity?.id || orbitdb.identity?.id;
		console.log('🔑 Instance identity after open (should be unchanged):', identityAfterOpen);
		if (identityAfterOpen !== currentInstanceIdentity) {
			console.warn(
				'⚠️ WARNING: Instance identity changed after opening database! Original:',
				currentInstanceIdentity,
				'Current:',
				identityAfterOpen
			);
		}

		// Verify database address wasn't changed
		if (todoDB.address !== dbAddress) {
			console.warn(
				'⚠️ WARNING: Database address changed! Original:',
				dbAddress,
				'Current:',
				todoDB.address
			);
		}

		// Check if access controller was recreated
		const hasWriteAccess = todoDB.access?.write?.includes(currentInstanceIdentity);
		if (dbNameIdentity && dbNameIdentity !== currentInstanceIdentity && hasWriteAccess) {
			console.warn('⚠️ WARNING: Access controller may have been recreated!');
			console.warn('   Database name identity:', dbNameIdentity);
			console.warn('   Current instance identity:', currentInstanceIdentity);
			console.warn('   Has write access:', hasWriteAccess);
			console.warn(
				'   This suggests a new access controller was created with our identity instead of using the original.'
			);
		} else {
			console.log('✅ Access controller appears to be original');
			console.log('   Database name identity:', dbNameIdentity);
			console.log('   Current instance identity:', currentInstanceIdentity);
			console.log('   Has write access:', hasWriteAccess);
		}

		// Initialize database stores and actions
		await initializeDatabase(orbitdb, todoDB, preferences);

		return todoDB;
	} catch (error) {
		console.error('❌ Error opening database by address:', error);
		throw error;
	}
}

/**
 * Get the current identity ID
 * @returns {string|null} The identity ID or null if not initialized
 */
export function getCurrentIdentityId() {
	return currentIdentity?.id || null;
}

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
		console.log(
			`✅ libp2p node created with network connection: ${enableNetworkConnection ? 'enabled' : 'disabled'}, peer connections: ${enablePeerConnections ? 'enabled' : 'disabled'}`
		);

		// Add global error handlers for libp2p stream errors
		// These errors are often non-fatal and can be safely ignored
		if (typeof window !== 'undefined') {
			// Handle unhandled promise rejections from libp2p streams
			window.addEventListener('unhandledrejection', (event) => {
				const error = event.reason;
				// Check if it's a stream-related error that we can safely ignore
				if (
					error &&
					(typeof error === 'string' || error instanceof Error) &&
					(error.message?.includes('remotePeer') ||
						error.message?.includes('shift') ||
						error.message?.includes('stream') ||
						error.toString().includes('remotePeer') ||
						error.toString().includes('shift'))
				) {
					console.warn('⚠️ Libp2p stream error (non-fatal):', error.message || error);
					event.preventDefault(); // Prevent the error from being logged to console
					return;
				}
			});

			// Handle general errors
			window.addEventListener('error', (event) => {
				const error = event.error || event.message;
				// Check if it's a stream-related error
				if (
					error &&
					(typeof error === 'string' || error instanceof Error) &&
					(error.message?.includes('remotePeer') ||
						error.message?.includes('shift') ||
						error.message?.includes('stream') ||
						error.toString().includes('remotePeer') ||
						error.toString().includes('shift'))
				) {
					console.warn('⚠️ Libp2p stream error (non-fatal):', error.message || error);
					event.preventDefault(); // Prevent the error from being logged to console
					return;
				}
			});
		}

		// Show toast notification for libp2p creation
		systemToasts.showLibp2pCreated();

		// Get and set peer ID
		peerId = libp2p.peerId.toString();
		console.log(`✅ peerId is ${peerId}`);
		peerIdStore.set(peerId);

		// Create Helia (IPFS) instance with mobile-aware storage handling
		let heliaConfig = { libp2p };
		let actuallyUsePersistentStorage = enablePersistentStorage;

		if (enablePersistentStorage) {
			try {
				console.log('🗄️ Initializing Helia with persistent storage (LevelDB)...');
				const blockstore = new LevelBlockstore('./helia-blocks');
				const datastore = new LevelDatastore('./helia-data');
				heliaConfig = { libp2p, blockstore, datastore };

				// Show toast for persistent storage
				systemToasts.showStoragePersistent();
			} catch (levelError) {
				console.warn(
					'⚠️ LevelDB initialization failed, falling back to in-memory storage:',
					levelError
				);
				actuallyUsePersistentStorage = false;

				// Show toast for storage test failure
				systemToasts.showStorageTestFailed();
			}
		}

		if (!actuallyUsePersistentStorage) {
			console.log('💾 Initializing Helia with in-memory storage...');
			// heliaConfig already has just { libp2p }, which defaults to in-memory storage

			// Show toast for in-memory storage (only if not already shown above)
			if (!enablePersistentStorage) {
				systemToasts.showStorageMemory();
			}
		}

		helia = await createHelia(heliaConfig);
		console.log(
			`✅ Helia created with ${actuallyUsePersistentStorage ? 'persistent' : 'in-memory'} storage`
		);

		// Show toast for Helia creation
		systemToasts.showHeliaCreated();

		// Create OrbitDB instance
		console.log('🛬 Creating OrbitDB instance...');
		orbitdb = await createOrbitDB({
			ipfs: helia,
			id: 'simple-todo-app',
			directory: './orbitdb'
		});

		// Show toast for OrbitDB creation
		systemToasts.showOrbitDBCreated();

		// Make OrbitDB instance available to other components
		orbitDBStore.set(orbitdb);

		// Get the identity from OrbitDB instance
		currentIdentity = orbitdb.identity;
		console.log('🔑 Current identity:', currentIdentity.id);

		// Initialize the registry database for this identity
		const identityId = currentIdentity.id;
		const registryDbName = identityId; // Registry DB is just the identityId

		console.log('📋 Initializing registry database...');
		const accessController = OrbitDBAccessController({
			write: [identityId]
		});

		const registryDb = await orbitdb.open(registryDbName, {
			type: 'keyvalue',
			create: true,
			sync: true,
			AccessController: accessController
		});

		// Ensure 'projects' is in the registry (default todo list)
		const projectsEntry = await registryDb.get('projects');
		if (!projectsEntry) {
			await registryDb.put('projects', {
				displayName: 'projects',
				dbName: `${identityId}_projects`,
				parent: null,
				createdAt: new Date().toISOString()
			});
			console.log('✅ Added "projects" to registry');
		}

		// Close registry database (we'll reopen it when needed)
		await registryDb.close();
		console.log('✅ Registry database initialized');

		// Open default todo list 'projects'
		await openTodoList('projects', preferences, null, null);

		// Mark initialization as complete
		initializationStore.set({ isInitializing: false, isInitialized: true, error: null });
		console.log('🎉 P2P initialization completed successfully!');
	} catch (error) {
		console.error('❌ Failed to initialize OrbitDB:', error);
		initializationStore.set({
			isInitializing: false,
			isInitialized: false,
			error: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}
