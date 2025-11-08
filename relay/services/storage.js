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

	// Always use fixed private key if provided (not just in dev mode)
	// This is especially important for CI environments where crypto.randomBytes might not work correctly
	if (fixedPrivateKey) {
		// Use fixed private key
		console.log('🔑 Using fixed private key');
		try {
			privateKey = privateKeyFromProtobuf(uint8ArrayFromString(fixedPrivateKey, 'hex'));
			console.log('✅ Fixed private key loaded successfully');
		} catch (error) {
			console.warn(
				'⚠️ Failed to load fixed private key, falling back to generated key:',
				error.message
			);
			try {
				privateKey = await loadOrCreateSelfKey(datastore);
			} catch (genError) {
				console.error('❌ Failed to generate private key:', genError);
				throw new Error(
					`Failed to load or generate private key. Please provide a valid RELAY_PRIV_KEY environment variable. Error: ${genError.message}`
				);
			}
		}
	} else {
		// Load or create persistent private key
		console.log('🔑 Loading or creating persistent private key...');
		try {
			privateKey = await loadOrCreateSelfKey(datastore);
			console.log('✅ Private key loaded/created successfully');
		} catch (error) {
			console.error('❌ Failed to load or create private key:', error);
			throw new Error(
				`Failed to load or create private key. This may be due to crypto.randomBytes not working correctly in this environment. Please provide a RELAY_PRIV_KEY environment variable. Error: ${error.message}`
			);
		}
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
