import { browser } from '$app/environment';

// Default configuration values
const DEFAULT_CONFIG = {
	databaseName: 'simple-hybrid-todos-01',
	websocketPort: 5174,
	appName: 'simple-todo',
	appVersion: '0.1.23'
};

// Database Configuration
export const DATABASE_CONFIG = {
	name: DEFAULT_CONFIG.databaseName,
	type: 'keyvalue',
	create: true,
	sync: true,
	AccessController: null // Will be set dynamically
};

// WebSocket Configuration
export const WEBSOCKET_CONFIG = {
	port: DEFAULT_CONFIG.websocketPort
};

// Application Configuration
export const APP_CONFIG = {
	name: DEFAULT_CONFIG.appName,
	version: DEFAULT_CONFIG.appVersion
};

// Common database names for cleanup operations
export const COMMON_DB_NAMES = [
	'simple-todos',
	'simple-hybrid-todos-01',
	'test-todos',
	'restored-todos'
];

// Get database name with fallback
export function getDatabaseName() {
	return DATABASE_CONFIG.name;
}

// Get WebSocket port with fallback
export function getWebSocketPort() {
	return WEBSOCKET_CONFIG.port;
}
