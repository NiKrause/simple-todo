import { createLibp2p } from 'libp2p';
import { createHelia } from 'helia';
import { createOrbitDB, IPFSAccessController, MemoryStorage } from '@orbitdb/core';
import { createLibp2pConfig } from '../libp2p-config.js';
import { LevelBlockstore } from 'blockstore-level';
import { LevelDatastore } from 'datastore-level';
import { mdns } from '@libp2p/mdns';
import { serverLogger } from '../console-logger.js';

class OrbitDBServer {
	constructor() {
		this.libp2p = null;
		this.helia = null;
		this.orbitdb = null;
		this.todoDB = null;
		this.peerId = null;
		this.isInitialized = false;
		this.connectedPeers = new Set();
		this.discoveredNodes = new Map();
	}

	async initialize(options = {}) {
		if (this.isInitialized) {
			console.log('🔄 OrbitDB server already initialized');
			return;
		}

		const {
			enableMDNS = false, // Disable mDNS for browser compatibility
			port = 3000,
			serviceName = 'simple-todo'
		} = options;

		try {
			serverLogger.info('🚀 Initializing OrbitDB server...');

			// Create libp2p configuration for server with mDNS
			const config = await createLibp2pConfig({
				enablePeerConnections: true,
				enableNetworkConnection: true,
				isServer: true,
				enableMDNS
			});

			// Add mDNS peer discovery if enabled
			if (enableMDNS) {
				config.peerDiscovery = config.peerDiscovery || [];
				config.peerDiscovery.push(mdns({
					interval: 20e3 // 20 seconds
				}));
			}

			// Create libp2p node
			this.libp2p = await createLibp2p(config);
			this.peerId = this.libp2p.peerId.toString();
			serverLogger.libp2p(`Node created with peerId: ${this.peerId}`);

			// Create Helia with persistent storage for server
			const blockstore = new LevelBlockstore('./server-helia-blocks');
			const datastore = new LevelDatastore('./server-helia-data');
			
			this.helia = await createHelia({
				libp2p: this.libp2p,
				blockstore,
				datastore
			});
			serverLogger.helia('Created with persistent storage (LevelDB)');

			// Create OrbitDB instance
			this.orbitdb = await createOrbitDB({
				ipfs: this.helia,
				id: 'simple-todo-server',
				directory: './server-orbitdb'
			});
			serverLogger.orbitdb('Instance created on server');

			// Open todos database
			this.todoDB = await this.orbitdb.open('simple-todos', {
				type: 'keyvalue',
				create: true,
				sync: true,
				AccessController: IPFSAccessController({ write: ['*'] })
			});
			serverLogger.orbitdb('Todos database opened (keyvalue type, sync enabled)');

			// Set up peer connection events
			this.libp2p.addEventListener('peer:connect', (event) => {
				const peerIdStr = event.detail.toString();
				this.connectedPeers.add(peerIdStr);
				serverLogger.libp2p(`Peer connected: ${peerIdStr}`);
			});

			this.libp2p.addEventListener('peer:disconnect', (event) => {
				const peerIdStr = event.detail.toString();
				this.connectedPeers.delete(peerIdStr);
				serverLogger.libp2p(`Peer disconnected: ${peerIdStr}`);
			});

			// Set up peer discovery events
			this.libp2p.addEventListener('peer:discovery', (event) => {
				const peerIdStr = event.detail.id.toString();
				const addresses = event.detail.multiaddrs.map(addr => addr.toString());
				
				const peerInfo = {
					peerId: peerIdStr,
					addresses,
					lastSeen: new Date().toISOString()
				};

				this.discoveredNodes.set(peerIdStr, peerInfo);
				serverLogger.mdns('Discovered peer', peerInfo);
			});

			this.isInitialized = true;
			serverLogger.success('OrbitDB server initialization completed');

		} catch (error) {
			console.error('❌ Failed to initialize OrbitDB server:', error);
			throw error;
		}
	}

	// Database operations
	async getTodos() {
		if (!this.todoDB) {
			throw new Error('Database not initialized');
		}

		const allTodos = await this.todoDB.all();
		return allTodos.map((todo) => ({
			id: todo.hash,
			key: todo.key,
			...todo.value
		})).sort((a, b) => {
			const dateA = new Date(a.createdAt || 0);
			const dateB = new Date(b.createdAt || 0);
			return dateB - dateA;
		});
	}

	async addTodo(text, assignee = null, createdBy = 'server') {
		if (!this.todoDB) {
			throw new Error('Database not initialized');
		}

		const todoId = `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		const todo = {
			text: text.trim(),
			completed: false,
			createdBy,
			assignee,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		await this.todoDB.put(todoId, todo);
		serverLogger.dbOp('ADD_TODO', { todoId, text });
		return { id: todoId, key: todoId, ...todo };
	}

	async toggleTodo(todoId) {
		if (!this.todoDB) {
			throw new Error('Database not initialized');
		}

		const existingTodo = await this.todoDB.get(todoId);
		if (!existingTodo) {
			throw new Error('Todo not found');
		}

		const todoData = existingTodo.value || existingTodo;
		const updatedTodo = {
			...todoData,
			completed: !todoData.completed,
			updatedAt: new Date().toISOString()
		};

		await this.todoDB.put(todoId, updatedTodo);
		serverLogger.dbOp('TOGGLE_TODO', { todoId, completed: updatedTodo.completed });
		return { id: todoId, key: todoId, ...updatedTodo };
	}

	async deleteTodo(todoId) {
		if (!this.todoDB) {
			throw new Error('Database not initialized');
		}

		await this.todoDB.del(todoId);
		console.log('✅ Server: Todo deleted:', todoId);
		return true;
	}

	async updateTodoAssignee(todoId, assignee) {
		if (!this.todoDB) {
			throw new Error('Database not initialized');
		}

		const existingTodo = await this.todoDB.get(todoId);
		if (!existingTodo) {
			throw new Error('Todo not found');
		}

		const todoData = existingTodo.value || existingTodo;
		const updatedTodo = {
			...todoData,
			assignee,
			updatedAt: new Date().toISOString()
		};

		await this.todoDB.put(todoId, updatedTodo);
		console.log('✅ Server: Todo assignee updated:', todoId, assignee);
		return { id: todoId, key: todoId, ...updatedTodo };
	}

	// Peer and status information
	getStatus() {
		return {
			isInitialized: this.isInitialized,
			peerId: this.peerId,
			connectedPeers: Array.from(this.connectedPeers),
			discoveredNodes: Array.from(this.discoveredNodes.values()),
			dbAddress: this.todoDB?.address
		};
	}

	getConnectedPeers() {
		return Array.from(this.connectedPeers);
	}

	getDiscoveredNodes() {
		return Array.from(this.discoveredNodes.values());
	}

	// Store peer information for reconnection
	async storePeerInfo(peerId, addresses) {
		const peerInfo = {
			peerId,
			addresses,
			lastSeen: new Date().toISOString()
		};
		
		this.discoveredNodes.set(peerId, peerInfo);
		
		// TODO: Store in persistent storage for reconnection after restart
		// This would be implemented with a dedicated peer storage mechanism
	}

	async close() {
		try {
			console.log('🔄 Shutting down OrbitDB server...');

			if (this.todoDB) {
				await this.todoDB.close();
			}

			if (this.orbitdb) {
				await this.orbitdb.stop();
			}

			if (this.helia) {
				await this.helia.stop();
			}

			if (this.libp2p) {
				await this.libp2p.stop();
			}

			this.isInitialized = false;
			console.log('✅ OrbitDB server shut down completed');
		} catch (error) {
			console.error('❌ Error shutting down OrbitDB server:', error);
		}
	}
}

// Singleton instance
let orbitDBServerInstance = null;

export function getOrbitDBServer() {
	if (!orbitDBServerInstance) {
		orbitDBServerInstance = new OrbitDBServer();
	}
	return orbitDBServerInstance;
}

export { OrbitDBServer };