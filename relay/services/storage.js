import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { join } from 'path';
import { loadOrCreateSelfKey } from '@libp2p/config';
import { privateKeyFromProtobuf } from '@libp2p/crypto/keys';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';

/**
 * Initialize persistent storage for the relay
 * @param {string} hostDirectory - Directory to store data
 * @param {boolean} isDevMode - Whether running in development mode
 * @param {string} fixedPrivateKey - Fixed private key for dev mode (optional)
 * @returns {Object} Storage components { datastore, blockstore, privateKey }
 */
export async function initializeStorage(hostDirectory, isDevMode = false, fixedPrivateKey = null) {
	console.log('🗄️ Initializing storage...', { hostDirectory, isDevMode });

	// Create datastore
	const datastore = new LevelDatastore(join(hostDirectory, 'data'));
	await datastore.open();
	console.log('✅ Datastore initialized');

	// Create blockstore
	const blockstore = new LevelBlockstore(join(hostDirectory, 'blocks'));
	await blockstore.open();
	console.log('✅ Blockstore initialized');

	let privateKey;

	if (isDevMode && fixedPrivateKey) {
		// Use fixed private key for development
		console.log('🔑 Using fixed private key for development mode');
		try {
			privateKey = privateKeyFromProtobuf(uint8ArrayFromString(fixedPrivateKey, 'hex'));
			console.log('✅ Fixed private key loaded successfully');
		} catch (error) {
			console.warn(
				'⚠️ Failed to load fixed private key, falling back to generated key:',
				error.message
			);
			privateKey = await loadOrCreateSelfKey(datastore);
		}
	} else {
		// Load or create persistent private key
		console.log('🔑 Loading or creating persistent private key...');
		privateKey = await loadOrCreateSelfKey(datastore);
		console.log('✅ Private key loaded/created successfully');
	}

	return { datastore, blockstore, privateKey };
}

/**
 * Close all storage components gracefully
 * @param {Object} storage - Storage components to close
 */
export async function closeStorage(storage) {
	console.log('🔄 Closing storage components...');

	try {
		if (storage.datastore) {
			await storage.datastore.close();
			console.log('✅ Datastore closed');
		}

		if (storage.blockstore) {
			await storage.blockstore.close();
			console.log('✅ Blockstore closed');
		}
	} catch (error) {
		console.error('❌ Error closing storage:', error);
		throw error;
	}

	console.log('✅ Storage closed successfully');
}
