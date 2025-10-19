<script>
	import { libp2pStore, peerIdStore, connectedPeersStore } from './p2p.js';
	import { todoDBStore } from './db-actions.js';
	import { getDatabaseName } from './config.js';
	import { hybridMode } from './hybrid-mode.js';
	import { websocketClient } from './websocket-client.js';
	import { onMount } from 'svelte';
	
	let dbName = getDatabaseName();
	let dbAddress = '';
	let wsStatus = 'Unknown';
	let wsConnected = false;
	
	// Reactive statements to update database info
	$: if ($todoDBStore) {
		dbAddress = $todoDBStore.address || 'Not connected';
	}
	
	// Get connected peers count from the reactive store
	$: connectedPeersCount = $connectedPeersStore.length;
	
	// Get peer ID (shortened)
	$: shortPeerId = $peerIdStore ? $peerIdStore.toString().slice(0, 8) + '...' : 'Loading...';
	
	// WebSocket connection status
	onMount(() => {
		const updateWsStatus = () => {
			const status = websocketClient.getConnectionStatus();
			wsConnected = status.isConnected;
			
			if ($hybridMode?.mode === 'client') {
				wsStatus = 'P2P';
			} else if (wsConnected) {
				wsStatus = 'Connected';
			} else if (status.reconnectAttempts > 0) {
				wsStatus = `Reconnecting (${status.reconnectAttempts})`;
			} else {
				wsStatus = 'Offline';
			}
		};
		
		// Subscribe to hybrid mode changes
		const unsubscribe = hybridMode.subscribe(() => {
			updateWsStatus();
		});
		
		// Check connection status periodically
		const interval = setInterval(updateWsStatus, 1000);
		
		// Initial check
		updateWsStatus();
		
		return () => {
			unsubscribe();
			clearInterval(interval);
		};
	});
</script>

<div class="compact-status-bar">
	<div class="status-grid">
		<!-- Mode Info -->
		<div class="status-item">
			<span class="status-label">⚙️ Mode:</span>
			<span class="status-value">{$hybridMode?.mode || 'Loading...'}</span>
		</div>
		
		<!-- Database Info -->
		<div class="status-item">
			<span class="status-label">🗄️ DB:</span>
			<span class="status-value">{dbName}</span>
		</div>
		
		<div class="status-item">
			<span class="status-label">📍 Address:</span>
			<span class="status-value" title={dbAddress}>
				{dbAddress ? dbAddress.slice(0, 20) + '...' : 'Not connected'}
			</span>
		</div>
		
		<!-- Peer Info -->
		<div class="status-item">
			<span class="status-label">👤 Peer:</span>
			<span class="status-value" title={$peerIdStore}>{shortPeerId}</span>
		</div>
		
		<div class="status-item">
			<span class="status-label">👥 Peers:</span>
			<span class="status-value">{connectedPeersCount}</span>
		</div>
		
		<!-- WebSocket Status -->
		<div class="status-item">
			<span class="status-label">🔌 Sync:</span>
			<span class="status-value" class:connected={wsConnected} class:offline={!wsConnected && wsStatus === 'Offline'}>
				{wsStatus}
			</span>
		</div>
	</div>
</div>

<style>
	.compact-status-bar {
		background: #f8f9fa;
		border: 1px solid #e9ecef;
		border-radius: 6px;
		padding: 8px 12px;
		margin-bottom: 16px;
		font-size: 12px;
	}
	
	.status-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 8px;
		align-items: center;
	}
	
	.status-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	
	.status-label {
		font-weight: 600;
		color: #6c757d;
		font-size: 11px;
	}
	
	.status-value {
		color: #495057;
		font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
		font-size: 11px;
		background: #ffffff;
		padding: 2px 6px;
		border-radius: 3px;
		border: 1px solid #dee2e6;
		word-break: break-all;
	}
	
	.status-value.connected {
		background: #d4edda;
		border-color: #c3e6cb;
		color: #155724;
	}
	
	.status-value.offline {
		background: #f8d7da;
		border-color: #f5c6cb;
		color: #721c24;
	}
	
	/* Responsive adjustments */
	@media (max-width: 640px) {
		.status-grid {
			grid-template-columns: 1fr;
			gap: 6px;
		}
		
		.status-item {
			justify-content: space-between;
		}
	}
</style>
