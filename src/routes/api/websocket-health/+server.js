import { websocketManager } from '$lib/server/websocket-server.js';
import { getOrbitDBServer } from '$lib/server/orbitdb-server.js';

export async function GET() {
	try {
		const orbitServer = getOrbitDBServer();
		const wsStatus = websocketManager.getStatus();
		const orbitStatus = orbitServer.getStatus();
		
		return new Response(JSON.stringify({
			status: 'ok',
			timestamp: Date.now(),
			websocket: {
				enabled: true,
				connectedClients: wsStatus.connectedClients,
				isInitialized: wsStatus.isInitialized
			},
			orbitdb: {
				isInitialized: orbitStatus.isInitialized,
				peerId: orbitStatus.peerId,
				connectedPeers: orbitStatus.connectedPeers?.length || 0,
				dbAddress: orbitStatus.dbAddress
			}
		}), {
			headers: { 
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache'
			}
		});
	} catch (error) {
		return new Response(JSON.stringify({
			status: 'error',
			timestamp: Date.now(),
			error: error.message,
			websocket: {
				enabled: false
			},
			orbitdb: {
				isInitialized: false
			}
		}), {
			status: 500,
			headers: { 
				'Content-Type': 'application/json',
				'Cache-Control': 'no-cache'
			}
		});
	}
}
