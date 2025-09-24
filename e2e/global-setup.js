import { startGlobalRelay } from './helpers/relay-server.js';

async function globalSetup() {
	console.log('🚀 Setting up global test environment...');
	// Start the relay server before all tests
	await startGlobalRelay();
	console.log('✅ Global setup complete');
}

export default globalSetup;
