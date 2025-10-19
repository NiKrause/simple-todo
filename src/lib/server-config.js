import { env } from '$env/dynamic/private';

// Server-side configuration with environment variables
export const SERVER_CONFIG = {
	databaseName: env.TODO_DB_NAME || 'simple-hybrid-todos-01',
	websocketPort: parseInt(env.WEBSOCKET_PORT) || 5174,
	appName: env.APP_NAME || 'simple-todo',
	appVersion: env.APP_VERSION || '0.1.23'
};

// Get database name for server use
export function getServerDatabaseName() {
	return SERVER_CONFIG.databaseName;
}

// Get WebSocket port for server use
export function getServerWebSocketPort() {
	return SERVER_CONFIG.websocketPort;
}
