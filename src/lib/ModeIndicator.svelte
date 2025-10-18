<script>
	import { onMount } from 'svelte';
	import { hybridMode } from './hybrid-mode.js';
	import { logger } from './console-logger.js';

	let showDetails = false;
	let currentMode = 'server';
	let serverAvailable = true;
	let clientInitialized = false;
	
	onMount(() => {
		// Subscribe to hybrid mode changes
		const unsubscribe = hybridMode.subscribe(state => {
			currentMode = state.mode;
			serverAvailable = state.serverAvailable;
			clientInitialized = state.clientInitialized;
		});

		// Log the stack status when component mounts
		logger.showStack();

		return unsubscribe;
	});

	function toggleDetails() {
		showDetails = !showDetails;
		if (showDetails) {
			logger.showStack();
		}
	}

	function getStatusColor(mode) {
		switch (mode) {
			case 'server':
				return 'bg-blue-500';
			case 'client':
				return 'bg-green-500';
			case 'initializing':
				return 'bg-yellow-500';
			default:
				return 'bg-gray-500';
		}
	}

	function getStackInfo(mode) {
		switch (mode) {
			case 'server':
				return {
					title: 'Server Mode (SSR)',
					orbitdb: 'Node.js Server',
					ipfs: 'Node.js Server',
					libp2p: 'Node.js Server',
					p2p: 'Server-to-Server mDNS',
					icon: '🖥️'
				};
			case 'client':
				return {
					title: 'Client Mode (PWA)',
					orbitdb: 'Browser',
					ipfs: 'Browser',
					libp2p: 'Browser',
					p2p: 'Browser-to-Browser WebRTC',
					icon: '📱'
				};
			case 'initializing':
				return {
					title: 'Initializing...',
					orbitdb: 'Loading...',
					ipfs: 'Loading...',
					libp2p: 'Loading...',
					p2p: 'Setting up...',
					icon: '⚡'
				};
			default:
				return {
					title: 'Unknown Mode',
					orbitdb: 'Unknown',
					ipfs: 'Unknown', 
					libp2p: 'Unknown',
					p2p: 'Unknown',
					icon: '❓'
				};
		}
	}

	$: stackInfo = getStackInfo(currentMode);
	$: statusColor = getStatusColor(currentMode);
</script>

<div class="fixed bottom-4 right-4 z-50">
	<!-- Mode indicator button -->
	<button
		on:click={toggleDetails}
		class="flex items-center gap-2 px-3 py-2 text-sm font-medium text-white rounded-lg shadow-lg transition-all hover:scale-105 {statusColor}"
		title="Click to see stack details"
	>
		<span class="text-lg">{stackInfo.icon}</span>
		<span>{stackInfo.title}</span>
		{#if !serverAvailable}
			<span class="animate-pulse">⚠️</span>
		{/if}
	</button>

	<!-- Detailed stack information -->
	{#if showDetails}
		<div class="absolute bottom-16 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-xl p-4 min-w-80 max-w-sm">
			<div class="mb-3 pb-2 border-b border-gray-200 dark:border-gray-600">
				<h3 class="font-bold text-lg text-gray-900 dark:text-white flex items-center gap-2">
					{stackInfo.icon}
					{stackInfo.title}
				</h3>
				<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
					Hybrid Web App Mode
				</div>
			</div>

			<!-- Stack components -->
			<div class="space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="font-medium text-gray-700 dark:text-gray-300">OrbitDB:</span>
					<span class="text-purple-600 dark:text-purple-400 font-mono text-xs">
						{stackInfo.orbitdb}
					</span>
				</div>
				<div class="flex justify-between">
					<span class="font-medium text-gray-700 dark:text-gray-300">IPFS/Helia:</span>
					<span class="text-cyan-600 dark:text-cyan-400 font-mono text-xs">
						{stackInfo.ipfs}
					</span>
				</div>
				<div class="flex justify-between">
					<span class="font-medium text-gray-700 dark:text-gray-300">libp2p:</span>
					<span class="text-red-600 dark:text-red-400 font-mono text-xs">
						{stackInfo.libp2p}
					</span>
				</div>
				<div class="flex justify-between">
					<span class="font-medium text-gray-700 dark:text-gray-300">P2P Type:</span>
					<span class="text-gray-600 dark:text-gray-400 font-mono text-xs">
						{stackInfo.p2p}
					</span>
				</div>
			</div>

			<!-- Status indicators -->
			<div class="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
				<div class="flex items-center gap-2 text-xs">
					<div class="flex items-center gap-1">
						<div class="w-2 h-2 rounded-full {serverAvailable ? 'bg-green-400' : 'bg-red-400'}"></div>
						<span class="text-gray-600 dark:text-gray-400">
							Server: {serverAvailable ? 'Available' : 'Unavailable'}
						</span>
					</div>
					{#if currentMode === 'client'}
						<div class="flex items-center gap-1">
							<div class="w-2 h-2 rounded-full {clientInitialized ? 'bg-green-400' : 'bg-yellow-400'}"></div>
							<span class="text-gray-600 dark:text-gray-400">
								Client: {clientInitialized ? 'Ready' : 'Initializing'}
							</span>
						</div>
					{/if}
				</div>
			</div>

			<!-- Console hint -->
			<div class="mt-3 pt-2 border-t border-gray-200 dark:border-gray-600">
				<div class="text-xs text-gray-500 dark:text-gray-400">
					💡 Check browser console for detailed logs<br/>
					🔧 Use <code class="bg-gray-100 dark:bg-gray-700 px-1 rounded">window.hybridLogger.showStack()</code>
				</div>
			</div>

			<!-- Close button -->
			<button
				on:click={toggleDetails}
				class="absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
			>
				✕
			</button>
		</div>
	{/if}
</div>