import { stopGlobalRelay } from './helpers/relay-server.js';

async function globalTeardown() {
	console.log('🛑 Tearing down global test environment...');
	// Stop the relay server after all tests
	await stopGlobalRelay();
	console.log('✅ Global teardown complete');
}

export default globalTeardown;
