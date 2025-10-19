import { todosStore } from './db-actions.js';
import { showToast } from './toast-store.js';
import { getWebSocketPort } from './config.js';

class WebSocketClient {
	constructor() {
		this.ws = null;
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 5;
		this.reconnectDelay = 1000;
		this.isConnected = false;
		this.reconnectTimer = null;
		this.pingInterval = null;
		this.pingTimeout = 30000; // 30 seconds
	}

	connect() {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			console.log('🔌 WebSocket already connected');
			return;
		}

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const host = window.location.hostname;
		const port = getWebSocketPort();
		const wsUrl = `${protocol}//${host}:${port}`;
		
		console.log('🔌 Connecting to WebSocket:', wsUrl);
		
		this.ws = new WebSocket(wsUrl);
		
		this.ws.onopen = () => {
			console.log('🔌 WebSocket connected');
			this.isConnected = true;
			this.reconnectAttempts = 0;
			this.startPingInterval();
			showToast('🔌 Real-time sync connected', 'success');
		};

		this.ws.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);
				this.handleServerMessage(data);
			} catch (error) {
				console.error('🔌 Error parsing WebSocket message:', error);
			}
		};

		this.ws.onclose = (event) => {
			console.log('🔌 WebSocket disconnected:', event.code, event.reason);
			this.isConnected = false;
			this.stopPingInterval();
			this.attemptReconnect();
		};

		this.ws.onerror = (error) => {
			console.error('🔌 WebSocket error:', error);
			this.isConnected = false;
		};
	}

	handleServerMessage(data) {
		console.log('🔌 Received WebSocket message:', data.type);
		
		switch (data.type) {
			case 'initial_data':
				this.handleInitialData(data);
				break;
			case 'todo_added':
				this.handleTodoAdded(data);
				break;
			case 'todo_updated':
				this.handleTodoUpdated(data);
				break;
			case 'todo_deleted':
				this.handleTodoDeleted(data);
				break;
			case 'database_replicated':
				this.handleDatabaseReplicated(data);
				break;
			case 'pong':
				// Server responded to ping
				break;
			default:
				console.warn('🔌 Unknown WebSocket message type:', data.type);
		}
	}

	async handleInitialData(data) {
		console.log('📋 Received initial data from server');
		if (data.todos && Array.isArray(data.todos)) {
			todosStore.set(data.todos);
			showToast(`📋 Loaded ${data.todos.length} todos from server`, 'info');
		}
	}

	async handleTodoAdded(data) {
		console.log('➕ New todo added via WebSocket');
		// Refresh todos from server to get latest state
		await this.refreshTodosFromServer();
		showToast('➕ New todo added', 'info');
	}

	async handleTodoUpdated(data) {
		console.log('🔄 Todo updated via WebSocket');
		await this.refreshTodosFromServer();
		showToast('🔄 Todo updated', 'info');
	}

	async handleTodoDeleted(data) {
		console.log('🗑️ Todo deleted via WebSocket');
		await this.refreshTodosFromServer();
		showToast('🗑️ Todo deleted', 'info');
	}

	async handleDatabaseReplicated(data) {
		console.log('🔄 Database replicated via WebSocket');
		await this.refreshTodosFromServer();
		showToast('🔄 Database synced', 'info');
	}

	async refreshTodosFromServer() {
		try {
			const response = await fetch('/api/todos');
			if (response.ok) {
				const result = await response.json();
				if (result.success && result.todos) {
					todosStore.set(result.todos);
					console.log('✅ Todos refreshed from server');
				}
			}
		} catch (error) {
			console.error('❌ Error refreshing todos:', error);
		}
	}

	startPingInterval() {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
		}
		
		this.pingInterval = setInterval(() => {
			if (this.ws && this.ws.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
			}
		}, this.pingTimeout);
	}

	stopPingInterval() {
		if (this.pingInterval) {
			clearInterval(this.pingInterval);
			this.pingInterval = null;
		}
	}

	attemptReconnect() {
		if (this.reconnectAttempts >= this.maxReconnectAttempts) {
			console.log('❌ Max reconnection attempts reached');
			showToast('❌ Real-time sync disconnected', 'error');
			return;
		}

		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}

		this.reconnectAttempts++;
		const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
		
		console.log(`🔄 Attempting to reconnect in ${delay}ms (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
		
		this.reconnectTimer = setTimeout(() => {
			this.connect();
		}, delay);
	}

	disconnect() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		
		this.stopPingInterval();
		
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		
		this.isConnected = false;
		console.log('🔌 WebSocket disconnected');
	}

	// Public API
	getConnectionStatus() {
		return {
			isConnected: this.isConnected,
			readyState: this.ws ? this.ws.readyState : null,
			reconnectAttempts: this.reconnectAttempts
		};
	}

	// Force refresh from server
	async requestRefresh() {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify({ type: 'request_refresh', timestamp: Date.now() }));
		} else {
			await this.refreshTodosFromServer();
		}
	}
}

// Singleton instance
export const websocketClient = new WebSocketClient();

// Make it available globally for debugging
if (typeof window !== 'undefined') {
	window.websocketClient = websocketClient;
	console.log('🔧 WebSocket client available as window.websocketClient');
}
