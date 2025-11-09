import { spawn } from 'child_process';
import { promisify } from 'util';
import { writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const sleep = promisify(setTimeout);

/**
 * RelayServer class manages the lifecycle of the P2P relay server for e2e tests
 */
export class RelayServer {
	constructor(options = {}) {
		this.options = {
			wsPort: 4011,
			tcpPort: 4012,
			webrtcPort: 4013,
			httpPort: 3001,
			webrtcDirectPort: 4016,
			...options
		};
		this.process = null;
		this.peerId = null;
		this.multiaddr = null;
		this.isReady = false;
		this.startupTimeout = 30000; // 30 seconds
	}

	/**
	 * Start the relay server and wait for it to be ready
	 */
	async start() {
		if (this.process) {
			throw new Error('Relay server is already running');
		}

		console.log('🚀 Starting relay server for e2e tests...');

		// Ensure relay directory exists
		const relayDir = path.join(process.cwd(), 'relay');
		if (!existsSync(relayDir)) {
			throw new Error('Relay directory not found. Make sure you are in the project root.');
		}

		// Create environment variables for the relay
		// Note: RELAY_PRIV_KEY can be provided via environment variable for CI environments
		// The crypto polyfill in relay-enhanced.js should handle key generation if not provided
		const env = {
			...process.env,
			NODE_ENV: 'development',
			RELAY_WS_PORT: this.options.wsPort.toString(),
			RELAY_TCP_PORT: this.options.tcpPort.toString(),
			RELAY_WEBRTC_PORT: this.options.webrtcPort.toString(),
			RELAY_WEBRTC_DIRECT_PORT: this.options.webrtcDirectPort.toString(),
			HTTP_PORT: this.options.httpPort.toString(),
			DATASTORE_PATH: './test-relay-datastore',
			PUBSUB_TOPICS: 'todo._peer-discovery._p2p._pubsub',
			STRUCTURED_LOGS: 'false' // Disable structured logs for cleaner test output
			// RELAY_PRIV_KEY will be used if provided in process.env
		};

		return new Promise((resolve, reject) => {
			// Start the relay server process
			this.process = spawn('node', ['relay-enhanced.js'], {
				cwd: relayDir,
				env,
				stdio: ['ignore', 'pipe', 'pipe']
			});

			let output = '';
			let errorOutput = '';

			// Collect stdout
			this.process.stdout.on('data', (data) => {
				const text = data.toString();
				output += text;
				// Log output for debugging
				process.stdout.write(text);

				// Look for success indicators - HTTP server must be ready
				if (
					text.includes('Enhanced Relay Server Ready!') ||
					text.includes('HTTP API Server:') ||
					(text.includes('Health check:') && text.includes('http://localhost'))
				) {
					this.parseRelayInfo(output);
					// Don't resolve immediately - wait for health check
					// The HTTP server might need a moment to be fully ready
					setTimeout(() => {
						this.isReady = true;
						resolve();
					}, 1000);
				}
			});

			// Collect stderr
			this.process.stderr.on('data', (data) => {
				const text = data.toString();
				errorOutput += text;
				// Only log errors, not all stderr
				if (text.includes('Error') || text.includes('error') || text.includes('ERROR')) {
					console.error('Relay stderr:', text);
				}

				// Also check stderr for success (some logs might go there)
				if (
					text.includes('Enhanced Relay Server Ready!') ||
					text.includes('HTTP API Server:') ||
					(text.includes('Health check:') && text.includes('http://localhost'))
				) {
					this.parseRelayInfo(output + errorOutput);
					setTimeout(() => {
						this.isReady = true;
						resolve();
					}, 1000);
				}
			});

			// Handle process exit
			this.process.on('exit', (code, signal) => {
				console.log(`Relay server exited with code ${code}, signal ${signal}`);
				this.process = null;
				this.isReady = false;

				if (!this.isReady) {
					reject(
						new Error(
							`Relay server failed to start. Exit code: ${code}. Output: ${output}. Error: ${errorOutput}`
						)
					);
				}
			});

			// Handle process errors
			this.process.on('error', (err) => {
				console.error('Relay server process error:', err);
				reject(err);
			});

			// Timeout protection
			setTimeout(() => {
				if (!this.isReady) {
					this.stop();
					reject(
						new Error(
							`Relay server failed to start within ${this.startupTimeout}ms. Output: ${output}. Error: ${errorOutput}`
						)
					);
				}
			}, this.startupTimeout);
		});
	}

	/**
	 * Parse relay server information from the output
	 */
	parseRelayInfo(output) {
		try {
			// Try to extract peer ID from logs - handle both formats
			const peerIdMatch =
				output.match(/peer id[:\s]+([A-Za-z0-9]+)/i) ||
				output.match(/Peer ID[:\s]+([A-Za-z0-9]+)/i);
			if (peerIdMatch) {
				this.peerId = peerIdMatch[1];
			}

			// Construct the expected multiaddr for WebSocket connection
			this.multiaddr = `/ip4/127.0.0.1/tcp/${this.options.wsPort}/ws/p2p/${this.peerId}`;

			console.log(`✅ Relay server ready with peer ID: ${this.peerId}`);
			console.log(`✅ WebSocket multiaddr: ${this.multiaddr}`);
		} catch (error) {
			console.warn('Failed to parse relay info:', error);
		}
	}

	/**
	 * Stop the relay server
	 */
	async stop() {
		if (!this.process) {
			return;
		}

		console.log('🛑 Stopping relay server...');

		return new Promise((resolve) => {
			const cleanup = () => {
				this.process = null;
				this.isReady = false;
				this.peerId = null;
				this.multiaddr = null;
				console.log('✅ Relay server stopped');
				resolve();
			};

			// Handle graceful shutdown
			this.process.on('exit', cleanup);

			// Try graceful shutdown first
			this.process.kill('SIGTERM');

			// Force kill after timeout
			setTimeout(() => {
				if (this.process) {
					console.log('⚠️  Force killing relay server...');
					this.process.kill('SIGKILL');
					cleanup();
				}
			}, 5000);
		});
	}

	/**
	 * Wait for the relay server to be healthy
	 */
	async waitForHealth(maxAttempts = 60, interval = 1000) {
		// Wait a bit before starting health checks to give server time to start
		await sleep(2000);

		for (let i = 0; i < maxAttempts; i++) {
			try {
				const response = await fetch(`http://localhost:${this.options.httpPort}/health`, {
					signal: AbortSignal.timeout(2000)
				});
				if (response.ok) {
					const health = await response.json();
					console.log('✅ Relay server health check passed:', health);
					return true;
				}
			} catch (error) {
				// Ignore fetch errors, server might not be ready yet
				if (i === maxAttempts - 1) {
					console.error('❌ Health check error:', error.message);
				}
			}

			if (i % 5 === 0 || i === maxAttempts - 1) {
				console.log(`⏳ Waiting for relay server health check... (${i + 1}/${maxAttempts})`);
			}
			await sleep(interval);
		}

		throw new Error('Relay server health check failed');
	}

	/**
	 * Get the WebSocket multiaddr for client connections
	 */
	getWebSocketMultiaddr() {
		if (!this.multiaddr) {
			throw new Error('Relay server is not ready or multiaddr not available');
		}
		return this.multiaddr;
	}

	/**
	 * Get connection info for the relay server
	 */
	getConnectionInfo() {
		return {
			peerId: this.peerId,
			multiaddr: this.multiaddr,
			ports: {
				ws: this.options.wsPort,
				tcp: this.options.tcpPort,
				webrtc: this.options.webrtcPort,
				http: this.options.httpPort,
				webrtcDirect: this.options.webrtcDirectPort
			}
		};
	}

	/**
	 * Create environment file for the application to use this relay
	 */
	async createEnvFile() {
		if (!this.multiaddr) {
			throw new Error('Relay server is not ready');
		}

		const envContent = `# Generated for e2e tests
NODE_ENV=development
VITE_RELAY_BOOTSTRAP_ADDR_DEV=${this.multiaddr}
VITE_PUBSUB_TOPICS=todo._peer-discovery._p2p._pubsub
`;

		await writeFile('.env.test', envContent);
		console.log('✅ Created .env.test file with relay configuration');
	}
}

/**
 * Global relay instance for shared use across tests
 */
let globalRelay = null;

/**
 * Start a global relay server instance
 */
export async function startGlobalRelay(options) {
	if (globalRelay) {
		return globalRelay;
	}

	globalRelay = new RelayServer(options);
	await globalRelay.start();
	await globalRelay.waitForHealth();
	await globalRelay.createEnvFile();

	return globalRelay;
}

/**
 * Stop the global relay server instance
 */
export async function stopGlobalRelay() {
	if (globalRelay) {
		await globalRelay.stop();
		globalRelay = null;
	}
}

/**
 * Get the global relay instance
 */
export function getGlobalRelay() {
	return globalRelay;
}
