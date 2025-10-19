import { WebSocketServer } from 'ws';
import { getOrbitDBServer } from './orbitdb-server.js';
import { serverLogger } from '../console-logger.js';
import { getServerWebSocketPort } from '../server-config.js';

class WebSocketManager {
	constructor() {
		this.wss = null;
		this.clients = new Set();
		this.orbitServer = null;
		this.isInitialized = false;
	}

	initialize(server) {
		if (this.isInitialized) {
			serverLogger.info('WebSocket server already initialized');
			return;
		}

		try {
			// Create WebSocket server on configured port
			const port = getServerWebSocketPort();
			this.wss = new WebSocketServer({ port });
			this.orbitServer = getOrbitDBServer();
			this.setupEventHandlers();
			this.isInitialized = true;
			serverLogger.success(`WebSocket server initialized on port ${port}`);
		} catch (error) {
			serverLogger.error('Failed to initialize WebSocket server:', error);
			throw error;
		}
	}

	setupEventHandlers() {
		this.wss.on('connection', (ws, request) => {
			const clientId = this.generateClientId();
			ws.clientId = clientId;
			this.clients.add(ws);
			
			serverLogger.info(`WebSocket client connected: ${clientId}`);
			
			// Send initial data
			this.sendInitialData(ws);
			
			// Setup client-specific handlers
			this.setupClientHandlers(ws);
		});

		this.wss.on('error', (error) => {
			serverLogger.error('WebSocket server error:', error);
		});
	}

	setupClientHandlers(ws) {
		ws.on('message', (data) => {
			try {
				const message = JSON.parse(data.toString());
				this.handleClientMessage(ws, message);
			} catch (error) {
				serverLogger.error('Error parsing client message:', error);
			}
		});

		ws.on('close', (code, reason) => {
			serverLogger.info(`WebSocket client disconnected: ${ws.clientId} (${code})`);
			this.clients.delete(ws);
		});

		ws.on('error', (error) => {
			serverLogger.error(`WebSocket client error (${ws.clientId}):`, error);
			this.clients.delete(ws);
		});
	}

	async sendInitialData(ws) {
		try {
			if (!this.orbitServer || !this.orbitServer.isInitialized) {
				serverLogger.error('OrbitDB server not ready, skipping initial data');
				return;
			}

			const todos = await this.orbitServer.getTodos();
			const status = this.orbitServer.getStatus();
			
			ws.send(JSON.stringify({
				type: 'initial_data',
				todos,
				status,
				timestamp: Date.now()
			}));
			
			serverLogger.info(`Sent initial data to client: ${ws.clientId}`);
		} catch (error) {
			serverLogger.error('Error sending initial data:', error);
		}
	}

	handleClientMessage(ws, message) {
		serverLogger.info(`Received message from ${ws.clientId}:`, message);
		
		switch (message.type) {
			case 'ping':
				ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
				break;
			case 'request_refresh':
				this.sendInitialData(ws);
				break;
			default:
				serverLogger.warning(`Unknown message type: ${message.type}`);
		}
	}

	broadcastToAll(message) {
		if (!this.wss || this.clients.size === 0) {
			return;
		}

		const data = JSON.stringify({
			...message,
			timestamp: Date.now()
		});

		let sentCount = 0;
		this.clients.forEach(client => {
			if (client.readyState === 1) { // WebSocket.OPEN
				try {
					client.send(data);
					sentCount++;
				} catch (error) {
					serverLogger.error('Error sending to client:', error);
					this.clients.delete(client);
				}
			}
		});

		serverLogger.info(`Broadcasted to ${sentCount} clients:`, message.type);
	}

	broadcastTodoAdded(todo) {
		this.broadcastToAll({
			type: 'todo_added',
			todo
		});
	}

	broadcastTodoUpdated(todo) {
		this.broadcastToAll({
			type: 'todo_updated',
			todo
		});
	}

	broadcastTodoDeleted(todoId) {
		this.broadcastToAll({
			type: 'todo_deleted',
			todoId
		});
	}

	broadcastDatabaseReplicated(address) {
		this.broadcastToAll({
			type: 'database_replicated',
			address
		});
	}

	generateClientId() {
		return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
	}

	getConnectedClients() {
		return Array.from(this.clients).map(ws => ({
			clientId: ws.clientId,
			readyState: ws.readyState
		}));
	}

	getStatus() {
		return {
			isInitialized: this.isInitialized,
			connectedClients: this.clients.size,
			clients: this.getConnectedClients()
		};
	}

	close() {
		if (this.wss) {
			this.wss.close();
			this.wss = null;
		}
		this.clients.clear();
		this.isInitialized = false;
		serverLogger.info('WebSocket server closed');
	}
}

// Singleton instance
export const websocketManager = new WebSocketManager();
