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

	// Extract CID from address (e.g., /orbitdb/zdpuAohjYazaPMsw4V8VmpyauTeTwzU64MzwQmAmcAiLQvoTz)
	const cidString = dbAddress.replace('/orbitdb/', '');
	
	// Retry loop to handle access controller recreation
	// OrbitDB should load the manifest from IPFS, but if it's not immediately available,
	// it may create a new access controller. We retry to allow time for network sync.
	const maxRetries = 3;
	let retryCount = 0;
	
	try {
		while (retryCount < maxRetries) {
			try {
				console.log('🔧 Opening database by address (all config from manifest)');
				console.log('🔧 Database address:', dbAddress);
				console.log('🔑 Current OrbitDB instance identity:', currentInstanceIdentity);
				if (retryCount > 0) {
					console.log(`🔄 Retry attempt ${retryCount} of ${maxRetries} - waiting for manifest to sync from network`);
				}

				// CRITICAL: Wait for manifest block AND access controller block to be available before opening
				// This prevents OrbitDB from creating a new access controller
				console.log('📥 Waiting for manifest block and access controller to be available in blockstore...');
				const manifestResult = await waitForManifestBlock(helia, cidString, 20000); // Wait up to 20 seconds
				
				if (!manifestResult.available) {
					if (retryCount < maxRetries - 1) {
						console.warn('⚠️ Manifest block not available yet, retrying...');
						retryCount++;
						await new Promise(resolve => setTimeout(resolve, 3000 * retryCount));
						continue;
					} else {
						console.error('❌ Manifest block not available after all retries');
						throw new Error('Manifest block not available on network');
					}
				}
				
				if (manifestResult.accessControllerAddress) {
					console.log('✅ Manifest and access controller blocks are available, opening database...');
				} else {
					console.log('✅ Manifest block is available, opening database...');
				}

				// Add timeout wrapper to prevent hanging indefinitely
				const openPromise = orbitdb.open(dbAddress);
				const timeoutPromise = new Promise((_, reject) =>
					setTimeout(() => reject(new Error('Database open timeout after 30 seconds')), 30000)
				);

				console.log('⏳ Waiting for database to open (this may take time if syncing from network)...');
				todoDB = await Promise.race([openPromise, timeoutPromise]);

				// Wait for initial sync to complete before checking records
				console.log('⏳ Waiting for database sync...');
				let shouldStopSyncCheck = false;
				await new Promise((resolve) => {
					// Wait up to 10 seconds for sync
					const syncTimeout = setTimeout(() => {
						console.log('⏰ Sync timeout - proceeding anyway');
						resolve();
					}, 10000);
					
					// Check if database has entries or wait for 'ready' event
					const checkSync = async () => {
						// Stop checking if we're retrying (todoDB was closed)
						if (shouldStopSyncCheck || !todoDB) {
							clearTimeout(syncTimeout);
							resolve();
							return;
						}
						
						try {
							const entries = await todoDB.all();
							if (entries.length > 0) {
								console.log('✅ Database sync complete, found', entries.length, 'entries');
								clearTimeout(syncTimeout);
								resolve();
							} else {
								// Wait a bit and check again
								setTimeout(checkSync, 500);
							}
						} catch (error) {
							// If todoDB is null, we're probably retrying - just resolve
							if (!todoDB) {
								clearTimeout(syncTimeout);
								resolve();
								return;
							}
							console.warn('⚠️ Error checking sync:', error);
							clearTimeout(syncTimeout);
							resolve();
						}
					};
					
					// Start checking after a short delay to allow sync to start
					setTimeout(checkSync, 1000);
					
					// Store resolve function so we can call it when retrying
					// This will stop the sync check
					checkSync.resolve = resolve;
					checkSync.stop = () => {
						shouldStopSyncCheck = true;
						clearTimeout(syncTimeout);
						resolve();
					};
				});

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
					if (retryCount < maxRetries - 1) {
						console.warn('⚠️ Access controller was recreated, retrying after network sync...');
						console.warn('   This suggests the manifest wasn\'t available yet. Waiting for network sync...');
						
						// Stop any ongoing sync checks before closing
						shouldStopSyncCheck = true;
						
						await todoDB.close();
						todoDB = null;
						
						// Wait for network sync - exponential backoff
						const waitTime = 2000 * (retryCount + 1);
						console.log(`⏳ Waiting ${waitTime}ms for network sync before retry...`);
						await new Promise(resolve => setTimeout(resolve, waitTime));
						retryCount++;
						continue; // Retry the loop
					} else {
						console.error('❌ Access controller was recreated after all retries. This may indicate the manifest is not available on the network.');
						// Fall through to return the database anyway
					}
				}
				
				// Success - break out of retry loop
				break;
			} catch (error) {
				if (retryCount < maxRetries - 1) {
					console.warn(`⚠️ Error opening database (attempt ${retryCount + 1}), retrying...`, error);
					retryCount++;
					// Wait before retry
					await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
					continue;
				} else {
					// Last retry failed, throw the error
					throw error;
				}
			}
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
 * Wait for a manifest block to be available in the blockstore
 * @param {Object} helia - Helia/IPFS instance
 * @param {string} cidString - CID string (e.g., "zdpuAohjYazaPMsw4V8VmpyauTeTwzU64MzwQmAmcAiLQvoTz")
 * @param {number} timeoutMs - Maximum time to wait in milliseconds
 * @returns {Promise<boolean>} True if manifest is available, false if timeout
 */
async function waitForManifestBlock(helia, cidString, timeoutMs = 10000) {
	if (!helia || !helia.blockstore) {
		console.warn('⚠️ No blockstore available');
		return false;
	}

	try {
		// Import CID parser
		const { CID } = await import('multiformats');
		const { base58btc } = await import('multiformats/bases/base58');
		
		// Parse CID from base58btc string
		const cid = CID.parse(cidString);
		
		const startTime = Date.now();
		const checkInterval = 500; // Check every 500ms
		
		while (Date.now() - startTime < timeoutMs) {
			try {
				// Try to get the block - this will throw if not available
				await helia.blockstore.get(cid);
				console.log('✅ Manifest block found in blockstore');
				return true;
			} catch (error) {
				// Block not available yet, wait and retry
				await new Promise(resolve => setTimeout(resolve, checkInterval));
			}
		}
		
		console.warn('⏰ Timeout waiting for manifest block');
		return false;
	} catch (error) {
		console.warn('⚠️ Error waiting for manifest block:', error);
		return false;
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
 * @param {boolean} preferences.skipDefaultDatabase - Whether to skip opening the default 'projects' database (e.g., when opening from URL hash)
 */
export async function initializeP2P(preferences = {}) {
	const {
		enablePersistentStorage = true,
		enableNetworkConnection = true,
		enablePeerConnections = true,
		skipDefaultDatabase = false
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
		
		// Add WebRTC connection debugging
		libp2p.addEventListener('peer:discovery', (event) => {
			const { id: peerId, multiaddrs } = event.detail || {};
			if (!peerId || !multiaddrs) return;
			const webrtcAddrs = multiaddrs.filter(addr => addr.toString().includes('/webrtc'));
			if (webrtcAddrs.length > 0) {
				console.log('🌐 WebRTC: Peer discovered with WebRTC addresses:', {
					peerId: peerId.toString().slice(0, 12) + '...',
					webrtcAddresses: webrtcAddrs.map(a => a.toString())
				});
			}
		});
		
		libp2p.addEventListener('peer:connect', (event) => {
			const connection = event.detail?.connection || event.detail;
			if (connection?.remoteAddr) {
				const addrStr = connection.remoteAddr.toString();
				if (addrStr.includes('/webrtc')) {
					console.log('🌐 WebRTC: Direct WebRTC connection established!', {
						peerId: connection.remotePeer?.toString().slice(0, 12) + '...',
						address: addrStr
					});
				}
			}
		});
		
		libp2p.addEventListener('connection:open', (event) => {
			const connection = event.detail;
			if (connection?.remoteAddr) {
				const addrStr = connection.remoteAddr.toString();
				if (addrStr.includes('/webrtc')) {
					console.log('🌐 WebRTC: Connection opened via WebRTC', {
						peerId: connection.remotePeer?.toString().slice(0, 12) + '...',
						address: addrStr,
						connectionId: connection.id
					});
				}
			}
		});

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
				const rawBlockstore = new LevelBlockstore('./helia-blocks');
				const blockstore = rawBlockstore;
				// console.log('[p2p.js] Raw blockstore created, wrapping with adapter...');
				// Wrap blockstore with adapter to ensure Uint8Array compatibility
				// const blockstore = createBlockstoreAdapter(rawBlockstore);
				// console.log('[p2p.js] Blockstore adapter created, type:', typeof blockstore, 'has get:', typeof blockstore.get === 'function');
				const datastore = new LevelDatastore('./helia-data');
				heliaConfig = { libp2p, blockstore, datastore };
				console.log('[p2p.js] Helia config prepared with adapted blockstore');

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
		
		// Wrap Helia's blockstore with adapter after creation
		// Helia might wrap our blockstore, so we need to wrap it again
		if (helia.blockstore) {
			console.log('🔧 WRAPPING HELIA BLOCKSTORE');
			console.log('🔧 Helia blockstore constructor:', helia.blockstore?.constructor?.name);
			console.log('🔧 Helia blockstore has get:', typeof helia.blockstore?.get === 'function');
			const originalBlockstore = helia.blockstore;
			// helia.blockstore = createBlockstoreAdapter(originalBlockstore);
			helia.blockstore = originalBlockstore;
			console.log('🔧 Helia blockstore wrapped successfully');
		} else {
			console.log('⚠️ WARNING: Helia has no blockstore property!');
		}

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

		// Open default todo list 'projects' unless we're skipping it (e.g., when opening from URL hash)
		if (!skipDefaultDatabase) {
			await openTodoList('projects', preferences, null, null);
		} else {
			console.log('⏭️ Skipping default database open (will be opened from URL hash)');
		}

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
