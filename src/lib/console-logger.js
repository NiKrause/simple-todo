import { browser } from '$app/environment';

// Console styling for better visibility
const styles = {
	server: 'background: #1e3a8a; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;',
	client: 'background: #059669; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;',
	hybrid: 'background: #7c2d12; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;',
	orbitdb: 'background: #4338ca; color: white; padding: 2px 6px; border-radius: 3px;',
	ipfs: 'background: #0891b2; color: white; padding: 2px 6px; border-radius: 3px;',
	libp2p: 'background: #dc2626; color: white; padding: 2px 6px; border-radius: 3px;',
	info: 'background: #374151; color: white; padding: 2px 6px; border-radius: 3px;'
};

class HybridLogger {
	constructor() {
		this.isServer = !browser;
		this.mode = this.isServer ? 'SERVER' : 'CLIENT';
		this.logBanner();
	}

	logBanner() {
		if (this.isServer) {
			console.log('\n🖥️  ==== SERVER-SIDE RENDERING (SSR) MODE ====');
			console.log('📋 OrbitDB/IPFS/libp2p running on Node.js server');
			console.log('🔄 No client-side P2P JavaScript execution');
			console.log('📝 Form-based interactions via SvelteKit actions');
			console.log('==============================================\n');
		} else {
			console.log('\n📱 ==== BROWSER/PWA MODE ====');
			console.log('🔍 Checking server availability...');
			console.log('⚡ Ready for client-side OrbitDB fallback');
			console.log('🔄 Hybrid mode detection active');
			console.log('=============================\n');
		}
	}

	// OrbitDB specific logging
	orbitdbServer(message, ...args) {
		if (this.isServer) {
			console.log(`%c${this.mode}%c %cOrbitDB%c ${message}`, 
				styles.server, '', styles.orbitdb, '', ...args);
		}
	}

	orbitdbClient(message, ...args) {
		if (!this.isServer) {
			console.log(`%c${this.mode}%c %cOrbitDB%c ${message}`, 
				styles.client, '', styles.orbitdb, '', ...args);
		}
	}

	// IPFS/Helia specific logging
	heliaServer(message, ...args) {
		if (this.isServer) {
			console.log(`%c${this.mode}%c %cIPFS/Helia%c ${message}`, 
				styles.server, '', styles.ipfs, '', ...args);
		}
	}

	heliaClient(message, ...args) {
		if (!this.isServer) {
			console.log(`%c${this.mode}%c %cIPFS/Helia%c ${message}`, 
				styles.client, '', styles.ipfs, '', ...args);
		}
	}

	// libp2p specific logging
	libp2pServer(message, ...args) {
		if (this.isServer) {
			console.log(`%c${this.mode}%c %clibp2p%c ${message}`, 
				styles.server, '', styles.libp2p, '', ...args);
		}
	}

	libp2pClient(message, ...args) {
		if (!this.isServer) {
			console.log(`%c${this.mode}%c %clibp2p%c ${message}`, 
				styles.client, '', styles.libp2p, '', ...args);
		}
	}

	// Hybrid mode transitions
	hybridTransition(message, ...args) {
		console.log(`%cHYBRID%c %cMode Change%c ${message}`, 
			styles.hybrid, '', styles.info, '', ...args);
	}

	// Mode detection
	modeDetection(message, ...args) {
		console.log(`%c${this.mode}%c %cDetection%c ${message}`, 
			this.isServer ? styles.server : styles.client, '', styles.info, '', ...args);
	}

	// Peer discovery (mDNS)
	mdnsDiscovery(message, ...args) {
		if (this.isServer) {
			console.log(`%c${this.mode}%c %cmDNS%c ${message}`, 
				styles.server, '', styles.info, '', ...args);
		}
	}

	// P2P connections
	p2pConnection(message, ...args) {
		console.log(`%c${this.mode}%c %cP2P%c ${message}`, 
			this.isServer ? styles.server : styles.client, '', styles.info, '', ...args);
	}

	// Generic logging with mode prefix
	info(message, ...args) {
		console.log(`%c${this.mode}%c ${message}`, 
			this.isServer ? styles.server : styles.client, '', ...args);
	}

	error(message, ...args) {
		console.error(`%c${this.mode}%c ❌ ${message}`, 
			this.isServer ? styles.server : styles.client, '', ...args);
	}

	success(message, ...args) {
		console.log(`%c${this.mode}%c ✅ ${message}`, 
			this.isServer ? styles.server : styles.client, '', ...args);
	}

	warning(message, ...args) {
		console.warn(`%c${this.mode}%c ⚠️ ${message}`, 
			this.isServer ? styles.server : styles.client, '', ...args);
	}

	// Show current stack summary
	showStack() {
		const timestamp = new Date().toISOString();
		
		if (this.isServer) {
			console.group(`🖥️  SERVER STACK STATUS - ${timestamp}`);
			console.log('Runtime Environment: Node.js Server');
			console.log('Rendering Mode: Server-Side Rendering (SSR)');
			console.log('OrbitDB Location: Server Process');
			console.log('IPFS/Helia Location: Server Process');  
			console.log('libp2p Location: Server Process');
			console.log('Client JavaScript: Minimal (Forms only)');
			console.log('P2P Capability: Server-to-Server via mDNS');
			console.groupEnd();
		} else {
			console.group(`📱 CLIENT STACK STATUS - ${timestamp}`);
			console.log('Runtime Environment: Browser/PWA');
			console.log('Rendering Mode: Client-Side Hydration');
			console.log('OrbitDB Location: Browser (if fallback active)');
			console.log('IPFS/Helia Location: Browser (if fallback active)');
			console.log('libp2p Location: Browser (if fallback active)');
			console.log('Client JavaScript: Full P2P Stack');
			console.log('P2P Capability: Browser-to-Browser WebRTC');
			console.groupEnd();
		}
	}

	// Log database operations with clear source
	dbOperation(operation, details, ...args) {
		const location = this.isServer ? 'Server OrbitDB' : 'Client OrbitDB';
		console.log(`%c${this.mode}%c %cOrbitDB%c ${operation} via ${location}`, 
			this.isServer ? styles.server : styles.client, '', styles.orbitdb, '', details, ...args);
	}
}

// Create singleton logger instance
export const logger = new HybridLogger();

// Convenience exports for different contexts
export const serverLogger = {
	orbitdb: (...args) => logger.orbitdbServer(...args),
	helia: (...args) => logger.heliaServer(...args),
	libp2p: (...args) => logger.libp2pServer(...args),
	mdns: (...args) => logger.mdnsDiscovery(...args),
	info: (...args) => logger.info(...args),
	error: (...args) => logger.error(...args),
	success: (...args) => logger.success(...args),
	dbOp: (...args) => logger.dbOperation(...args)
};

export const clientLogger = {
	orbitdb: (...args) => logger.orbitdbClient(...args),
	helia: (...args) => logger.heliaClient(...args),
	libp2p: (...args) => logger.libp2pClient(...args),
	p2p: (...args) => logger.p2pConnection(...args),
	hybrid: (...args) => logger.hybridTransition(...args),
	info: (...args) => logger.info(...args),
	error: (...args) => logger.error(...args),
	success: (...args) => logger.success(...args),
	dbOp: (...args) => logger.dbOperation(...args)
};

// Make logger available globally for debugging
if (browser && typeof window !== 'undefined') {
	window.hybridLogger = logger;
	console.log('%cHYBRID%c Logger available globally as window.hybridLogger', styles.hybrid, '');
	console.log('Available methods: .showStack(), .info(), .dbOperation(), etc.');
}