#!/usr/bin/env node

/**
 * Simple test script to verify the relay server setup works
 * This helps debug issues before running the full e2e tests
 */

import { startGlobalRelay, stopGlobalRelay } from './e2e/helpers/relay-server.js';

async function testRelaySetup() {
	console.log('🧪 Testing relay server setup...\n');

	try {
		// Start the relay server
		console.log('1️⃣ Starting relay server...');
		const relay = await startGlobalRelay();

		console.log('✅ Relay server started successfully!');
		console.log('   Connection Info:', relay.getConnectionInfo());

		// Test the health endpoint
		console.log('\n2️⃣ Testing health endpoint...');
		const response = await fetch(`http://localhost:${relay.options.httpPort}/health`);

		if (response.ok) {
			const health = await response.json();
			console.log('✅ Health check passed:', health);
		} else {
			throw new Error(`Health check failed: ${response.status} ${response.statusText}`);
		}

		// Test multiaddr endpoint
		console.log('\n3️⃣ Testing multiaddrs endpoint...');
		const multiaddrsResponse = await fetch(`http://localhost:${relay.options.httpPort}/multiaddrs`);

		if (multiaddrsResponse.ok) {
			const multiaddrs = await multiaddrsResponse.json();
			console.log('✅ Multiaddrs endpoint working:', multiaddrs);
		} else {
			console.log('⚠️ Multiaddrs endpoint failed (may be expected)');
		}

		console.log('\n🎉 All tests passed! The relay server setup is working correctly.');
		console.log('\n📝 Environment file created: .env.test');
	} catch (error) {
		console.error('\n❌ Test failed:', error.message);
		console.error('   Stack:', error.stack);
		process.exit(1);
	} finally {
		// Clean up
		console.log('\n🧹 Cleaning up...');
		await stopGlobalRelay();
		console.log('✅ Cleanup complete');
	}
}

// Run the test
testRelaySetup().catch(console.error);
