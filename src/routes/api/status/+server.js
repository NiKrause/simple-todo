import { json } from '@sveltejs/kit';
import { getOrbitDBServer } from '../../../lib/server/orbitdb-server.js';

const orbitServer = getOrbitDBServer();

export async function GET() {
	try {
		const status = orbitServer.getStatus();
		return json({ 
			...status, 
			mode: 'server',
			timestamp: new Date().toISOString(),
			success: true 
		});
	} catch (error) {
		console.error('❌ API: Error getting status:', error);
		return json({ 
			error: error.message, 
			mode: 'server',
			isInitialized: false,
			success: false 
		}, { status: 500 });
	}
}