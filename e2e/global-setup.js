import { startGlobalRelay } from './helpers/relay-server.js';
import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import path from 'path';

async function globalSetup() {
	console.log('🚀 Setting up global test environment...');
	
	// Clean up any existing test datastore to avoid lock issues
	const testDatastorePath = path.join(process.cwd(), 'relay', 'test-relay-datastore');
	if (existsSync(testDatastorePath)) {
		try {
			await rm(testDatastorePath, { recursive: true, force: true });
			console.log('✅ Cleaned up existing test datastore');
		} catch (error) {
			console.warn('⚠️ Could not clean up test datastore:', error.message);
		}
	}
	
	// Kill any processes that might be holding ports
	try {
		const { exec } = await import('child_process');
		const { promisify } = await import('util');
		const execAsync = promisify(exec);
		await execAsync('lsof -ti:4011,4012,4013,4016,3001 2>/dev/null | xargs kill -9 2>/dev/null || true');
		// Wait a moment for ports to be released
		await new Promise((resolve) => setTimeout(resolve, 1000));
	} catch (error) {
		// Ignore errors - ports might not be in use
	}
	
	// Start the relay server before all tests
	await startGlobalRelay();
	console.log('✅ Global setup complete');
}

export default globalSetup;
