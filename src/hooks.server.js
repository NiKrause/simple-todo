import { websocketManager } from '$lib/server/websocket-server.js';

// Global flag to ensure WebSocket server is only initialized once
let websocketInitialized = false;

export async function handle({ event, resolve }) {
	// Initialize WebSocket server on first request
	if (!websocketInitialized) {
		try {
			websocketManager.initialize();
			websocketInitialized = true;
			console.log('🔌 WebSocket server initialized on port 5174');
		} catch (error) {
			console.error('Failed to initialize WebSocket server:', error);
		}
	}
	
	const response = await resolve(event);
	return response;
}
