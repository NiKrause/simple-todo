import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { initializeP2P } from './p2p.js';
import { todosStore } from './db-actions.js';
import { clientLogger } from './console-logger.js';

// Hybrid mode state
export const hybridMode = writable({
	mode: 'server', // 'server', 'client', 'initializing'
	serverAvailable: true,
	clientInitialized: false,
	error: null,
	lastCheck: null
});

class HybridModeManager {
	constructor(initialData) {
		this.currentMode = initialData?.mode || 'server';
		this.serverAvailable = initialData?.serverAvailable ?? true;
		this.isClientInitialized = false;
		this.storedPeers = new Map();
		
		// Set initial state from server data
		if (initialData) {
			hybridMode.set({
				mode: this.currentMode,
				serverAvailable: this.serverAvailable,
				clientInitialized: false,
				error: initialData.error || null,
				lastCheck: new Date().toISOString()
			});
			
			// If server failed or mode indicates fallback, immediately switch to client mode
			if (!this.serverAvailable || initialData.mode === 'client-fallback') {
				console.log('📱 Server not available, auto-switching to client mode');
				// Use setTimeout to allow UI to initialize first
				setTimeout(() => {
					this.switchToClientMode('Server unavailable on page load');
				}, 100);
			}
		}
		
		if (browser) {
			this.loadStoredPeers();
			this.setupServiceWorkerPeerPersistence();
		}
	}

	async switchToClientMode(reason = 'Server unavailable') {
		if (this.currentMode === 'client') {
			clientLogger.info('Already in client mode');
			return;
		}

		clientLogger.hybrid(`Switching to client mode: ${reason}`);
		
		this.currentMode = 'client';
		this.serverAvailable = false;
		
		hybridMode.set({
			mode: 'initializing',
			serverAvailable: false,
			clientInitialized: false,
			error: null,
			lastCheck: new Date().toISOString()
		});

		try {
			// Initialize client-side OrbitDB
			await this.initializeClientMode();
			
			hybridMode.set({
				mode: 'client',
				serverAvailable: false,
				clientInitialized: true,
				error: null,
				lastCheck: new Date().toISOString()
			});
			
			clientLogger.success('Successfully switched to client mode');
		} catch (error) {
			clientLogger.error('Failed to switch to client mode:', error);
			
			hybridMode.set({
				mode: 'client',
				serverAvailable: false,
				clientInitialized: false,
				error: `Client initialization failed: ${error.message}`,
				lastCheck: new Date().toISOString()
			});
		}
	}

	async initializeClientMode() {
		if (this.isClientInitialized) {
			console.log('🔄 Client already initialized');
			return;
		}

		console.log('🚀 Initializing client-side OrbitDB...');
		
		// Use stored peer preferences or defaults
		const preferences = this.getStoredPreferences() || {
			enablePersistentStorage: true,
			enableNetworkConnection: true,
			enablePeerConnections: true
		};

		// Initialize P2P with stored peer information for reconnection
		if (this.storedPeers.size > 0) {
			console.log(`📱 Found ${this.storedPeers.size} stored peers for reconnection`);
			// TODO: Add logic to attempt reconnection to stored peers
		}

		await initializeP2P(preferences);
		this.isClientInitialized = true;
	}

	// Peer storage and reconnection logic
	loadStoredPeers() {
		try {
			const stored = localStorage.getItem('simple-todo-peers');
			if (stored) {
				const peers = JSON.parse(stored);
				this.storedPeers = new Map(Object.entries(peers));
				console.log(`📱 Loaded ${this.storedPeers.size} stored peers`);
			}
		} catch (error) {
			console.warn('⚠️ Failed to load stored peers:', error);
		}
	}

	storePeerInfo(peerId, addresses) {
		if (!browser) return;
		
		const peerInfo = {
			peerId,
			addresses: Array.isArray(addresses) ? addresses : [addresses],
			lastSeen: new Date().toISOString()
		};
		
		this.storedPeers.set(peerId, peerInfo);
		
		// Persist to localStorage
		try {
			const peersObj = Object.fromEntries(this.storedPeers);
			localStorage.setItem('simple-todo-peers', JSON.stringify(peersObj));
			console.log(`📱 Stored peer info for ${peerId}`);
		} catch (error) {
			console.warn('⚠️ Failed to store peer info:', error);
		}
	}

	getStoredPreferences() {
		if (!browser) return null;
		
		try {
			const stored = localStorage.getItem('simple-todo-preferences');
			return stored ? JSON.parse(stored) : null;
		} catch (error) {
			console.warn('⚠️ Failed to load stored preferences:', error);
			return null;
		}
	}

	storePreferences(preferences) {
		if (!browser) return;
		
		try {
			localStorage.setItem('simple-todo-preferences', JSON.stringify(preferences));
		} catch (error) {
			console.warn('⚠️ Failed to store preferences:', error);
		}
	}

	// Service worker peer persistence for PWA
	setupServiceWorkerPeerPersistence() {
		if (!browser || !('serviceWorker' in navigator)) return;

		// Listen for peer connection events and store them
		window.addEventListener('peer-connected', (event) => {
			const { peerId, addresses } = event.detail;
			this.storePeerInfo(peerId, addresses);
		});

		// Listen for peer discovery events
		window.addEventListener('peer-discovered', (event) => {
			const { peerId, addresses } = event.detail;
			this.storePeerInfo(peerId, addresses);
		});
	}

	// Utility methods
	getCurrentMode() {
		return this.currentMode;
	}

	isServerMode() {
		return this.currentMode === 'server';
	}

	isClientMode() {
		return this.currentMode === 'client';
	}

	getStoredPeers() {
		return Array.from(this.storedPeers.values());
	}

	// Manual fallback trigger (for PWA when server is detected as down)
	async triggerClientFallback() {
		console.log('🔄 Manual client fallback triggered');
		await this.switchToClientMode('Manual fallback requested');
	}
}

// Singleton instance
let hybridManager = null;

export function initializeHybridMode(serverData) {
	if (!hybridManager && browser) {
		hybridManager = new HybridModeManager(serverData);
	}
	return hybridManager;
}

export function getHybridManager() {
	return hybridManager;
}

export { HybridModeManager };