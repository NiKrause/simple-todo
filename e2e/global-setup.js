import { spawn } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { rm } from 'fs/promises';
import path from 'path';

let relayProcess = null;

export default async function globalSetup() {
	console.log('🚀 Setting up global test environment...');

	// Clean up test datastore
	const testDatastorePath = path.join(process.cwd(), 'relay', 'test-relay-datastore');
	if (existsSync(testDatastorePath)) {
		try {
			await rm(testDatastorePath, { recursive: true, force: true });
		} catch (error) {
			console.warn('⚠️ Could not clean up test datastore:', error.message);
		}
	}

	// Kill any processes holding ports
	try {
		const { exec } = await import('child_process');
		const { promisify } = await import('util');
		const execAsync = promisify(exec);
		await execAsync(
			'lsof -ti:4001,4002,4003,4006,3000 2>/dev/null | xargs kill -9 2>/dev/null || true'
		);
		await new Promise((resolve) => setTimeout(resolve, 1000));
	} catch {
		// Ignore errors
	}

	// Start relay server
	return new Promise((resolve, reject) => {
		relayProcess = spawn('node', ['relay-enhanced.js'], {
			cwd: path.join(process.cwd(), 'relay'),
			env: {
				...process.env,
				NODE_ENV: 'development',
				RELAY_PRIV_KEY: process.env.RELAY_PRIV_KEY, // Explicitly pass it
				RELAY_WS_PORT: '4001',
				RELAY_TCP_PORT: '4002',
				RELAY_WEBRTC_PORT: '4003',
				RELAY_WEBRTC_DIRECT_PORT: '4006',
				HTTP_PORT: '3000',
				DATASTORE_PATH: './test-relay-datastore',
				PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub',
				STRUCTURED_LOGS: 'false'
			},
			stdio: ['ignore', 'pipe', 'pipe']
		});

		let output = '';
		let relayMultiaddr = null;

		relayProcess.stdout.on('data', (data) => {
			const text = data.toString();
			output += text;
			process.stdout.write(text);

			// Extract peer ID and create multiaddr
			const peerIdMatch = text.match(/peer id[:\s]+([A-Za-z0-9]+)/i);
			if (peerIdMatch && !relayMultiaddr) {
				const peerId = peerIdMatch[1];
				relayMultiaddr = `/ip4/127.0.0.1/tcp/4001/ws/p2p/${peerId}`;
				
				// Create .env.development file for Vite
				const envContent = `# Generated for e2e tests
NODE_ENV=development
VITE_NODE_ENV=development
VITE_RELAY_BOOTSTRAP_ADDR_DEV=${relayMultiaddr}
VITE_PUBSUB_TOPICS=todo._peer-discovery._p2p._pubsub
`;
				writeFileSync('.env.development', envContent);
				console.log(`✅ Created .env.development with relay: ${relayMultiaddr}`);

				// Store relay info
				writeFileSync(
					path.join(process.cwd(), 'e2e', 'relay-info.json'),
					JSON.stringify({ multiaddr: relayMultiaddr, pid: relayProcess.pid }, null, 2)
				);

				// Wait for health check
				setTimeout(() => resolve(), 2000);
			}
		});

		relayProcess.stderr.on('data', (data) => {
			const text = data.toString();
			if (text.match(/error/i)) {
				console.error('Relay stderr:', text);
			}
		});

		relayProcess.on('error', (error) => {
			console.error('Failed to start relay:', error);
			reject(error);
		});

		// Timeout
		setTimeout(() => {
			if (!relayMultiaddr) {
				relayProcess?.kill();
				reject(new Error('Relay server failed to start within timeout'));
			}
		}, 30000);
	});
}
