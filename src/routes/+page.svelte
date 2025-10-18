<script>
	/* eslint-disable no-undef */
	import { onMount } from 'svelte';
	
	// Server data from SSR
	export let data;
	import { fade, fly } from 'svelte/transition';
	import { peerIdStore, initializeP2P, initializationStore, libp2pStore } from '$lib/p2p.js';
	import {
		todosStore,
		addTodo,
		deleteTodo,
		toggleTodoComplete,
		todoDBStore,
		loadTodos,
		orbitdbStore
	} from '$lib/db-actions.js';
	import ConsentModal from '$lib/ConsentModal.svelte';
	import SocialIcons from '$lib/SocialIcons.svelte';
	import SystemToast from '$lib/SystemToast.svelte';
	import LoadingSpinner from '$lib/LoadingSpinner.svelte';
	import ErrorAlert from '$lib/ErrorAlert.svelte';
	import AddTodoForm from '$lib/AddTodoForm.svelte';
	import TodoList from '$lib/TodoList.svelte';
	import ConnectedPeers from '$lib/ConnectedPeers.svelte';
	import PeerIdCard from '$lib/PeerIdCard.svelte';
	// Import StorachaIntegration conditionally to avoid SSR issues
	let StorachaIntegration;
	
	// Dynamically import StorachaIntegration to avoid SSR issues
	async function loadStorachaIntegration() {
		if (!StorachaIntegration) {
			const module = await import('$lib/StorachaIntegration.svelte');
			StorachaIntegration = module.default;
		}
	}
	import QRCodeModal from '$lib/QRCodeModal.svelte';
	// import { Cloud } from 'lucide-svelte'; // Unused for now
	import { toastStore } from '$lib/toast-store.js';
	// Import hybrid mode detection
	import { initializeHybridMode, getHybridManager, hybridMode } from '$lib/hybrid-mode.js';
import { getFormInterceptor } from '$lib/form-interceptor.js';
import { browser } from '$app/environment';
import ModeIndicator from '$lib/ModeIndicator.svelte';

	const CONSENT_KEY = `consentAccepted@${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}`;

	let error = null;
	let myPeerId = null;

	// Modal state
	let showModal = true;
	let rememberDecision = false;
	let preferences = {
		enablePersistentStorage: true,
		enableNetworkConnection: true,
		enablePeerConnections: true
	};

	// Storacha integration state
	let showStorachaIntegration = false;

	// QR Code modal state
	let showQRCodeModal = false;

	const handleModalClose = async (event) => {
		showModal = false;

		// Extract preferences from the event detail
		preferences = event?.detail || {};
		console.log('🔧 DEBUG: Received preferences from ConsentModal:', preferences);

		try {
			if (rememberDecision) {
				localStorage.setItem(CONSENT_KEY, 'true');
			}
		} catch {
			// ignore storage errors
		}

		try {
			// Only initialize P2P if server is not available
			if (typeof window !== 'undefined' && !data?.serverAvailable) {
				console.log('🔧 DEBUG: Server not available, initializing client P2P with preferences');
				await initializeP2P(preferences);
			} else {
				console.log('🔧 DEBUG: Server available, using server-side OrbitDB');
				// Show server mode indicator
				toastStore.show('🖥️ Using server-side OrbitDB', 'info');
			}
		} catch (err) {
			error = `Failed to initialize P2P or OrbitDB: ${err.message}`;
			console.error('P2P initialization failed:', err);
		}
	};

	// Make refresh function and store available globally as soon as component loads
	if (typeof window !== 'undefined') {
		window.refreshTodosFromServer = refreshTodosFromServer;
		window.todosStore = todosStore;
	}

	onMount(() => {
		let pollInterval;
		
		const initialize = async () => {
			try {
				// Check for offline fallback query parameter
				if (browser) {
					const urlParams = new URLSearchParams(window.location.search);
					const isOfflineFallback = urlParams.has('offline');
					
					if (isOfflineFallback) {
						console.log('🔄 Detected offline fallback mode - forcing client mode');
						// Clean up URL
						urlParams.delete('offline');
						const newUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
						history.replaceState({}, '', newUrl);
						
						// Force client mode by overriding server data
						data = {
							...data,
							mode: 'client-fallback',
							serverAvailable: false,
							todos: data?.todos || []
						};
						
							// Show immediate feedback
						toastStore.show('📱 Running in offline PWA mode', 'info');
					}
				}
				
				// Initialize hybrid mode detection with server data
				if (browser) {
					console.log('🔄 Initializing hybrid mode with server data:', data);
					initializeHybridMode(data);
					
					// Initialize form interceptor for offline handling
					getFormInterceptor();
					
					// If offline fallback was detected, trigger immediate client mode
					if (data?.mode === 'client-fallback') {
						const hybridManager = getHybridManager();
						if (hybridManager) {
							setTimeout(() => {
								hybridManager.switchToClientMode('Offline fallback mode detected');
							}, 500);
						}
					}
				}
				
				// Sync server todos to client store if available
				if (data?.todos && data.todos.length > 0) {
					console.log(`📋 Syncing ${data.todos.length} todos from server to client store`);
					todosStore.set(data.todos);
				}
				
				if (localStorage.getItem(CONSENT_KEY) === 'true') {
					showModal = false;
					
					// Check if hybrid manager suggests client mode
					const hybridManager = getHybridManager();
					if (hybridManager && !hybridManager.isServerMode()) {
						console.log('🔧 DEBUG: Hybrid manager suggests client mode, initializing P2P');
						await initializeP2P({
							enablePersistentStorage: true,
							enableNetworkConnection: true,
							enablePeerConnections: true
						});
					} else {
						console.log('🔧 DEBUG: Server mode active, using server-side OrbitDB');
						// Show server mode indicator
						toastStore.show('🖥️ Using server-side OrbitDB', 'info');
						
									// Set up server health monitoring via ping
							pollInterval = setInterval(async () => {
								try {
									// Simple health check - just ping the base URL
									const response = await fetch('/', {
										method: 'HEAD',
										cache: 'no-cache'
									});
									
									if (!response.ok) {
										throw new Error(`Server responded with ${response.status}`);
									}
									
									// Server is healthy, continue
									console.log('🖥️ Server health check passed');
								} catch (error) {
									console.warn('❌ Server health check failed, triggering client fallback:', error);
									// Server is unreachable, switch to client mode
									const manager = getHybridManager();
									if (manager) {
										await manager.triggerClientFallback();
										clearInterval(pollInterval);
										pollInterval = null;
									}
								}
							}, 10000); // Check every 10 seconds
					}
				}
			} catch {
				// ignore storage errors
			}
		};
		
		initialize();
		
		// Cleanup on component destroy
		return () => {
			if (pollInterval) {
				clearInterval(pollInterval);
			}
		};
	});

	// Function to refresh todos from server API (for server mode)
	async function refreshTodosFromServer() {
		console.log('🔄 refreshTodosFromServer called');
		try {
			const response = await fetch('/api/todos');
			console.log('🌐 API response status:', response.status, response.ok);
			if (response.ok) {
				const result = await response.json();
				console.log('📊 API result:', result);
				if (result.success) {
					console.log(`🔄 Refreshed ${result.todos.length} todos from server`);
					todosStore.set(result.todos);
					console.log('✅ Store updated successfully');
					return true;
				} else {
					console.warn('⚠️ API returned success:false');
				}
			} else {
				console.warn('⚠️ API response not ok:', response.status);
			}
		} catch (error) {
			console.error('❌ Failed to refresh todos from server:', error);
		}
		console.log('❌ refreshTodosFromServer returning false');
		return false;
	}

	const handleAddTodo = async (event) => {
		// This should only be called in client mode
		// Server mode uses form enhancement directly
		if ($hybridMode?.mode === 'client') {
			const success = await addTodo(event.detail.text);
			if (success) {
				toastStore.show('✅ Todo added successfully!', 'success');
			} else {
				toastStore.show('❌ Failed to add todo', 'error');
			}
		} else {
			console.log('🖥️ Server mode: Form enhancement should handle adding todo');
		}
	};

	const handleDelete = async (event) => {
		const success = await deleteTodo(event.detail.key);
		if (success) {
			toastStore.show('🗑️ Todo deleted successfully!', 'success');
		} else {
			toastStore.show('❌ Failed to delete todo', 'error');
		}
	};

	const handleToggleComplete = async (event) => {
		const success = await toggleTodoComplete(event.detail.key);
		if (success) {
			toastStore.show('✅ Todo status updated!', 'success');
		} else {
			toastStore.show('❌ Failed to update todo', 'error');
		}
	};

	// Subscribe to the peerIdStore
	$: myPeerId = $peerIdStore;

	let connectedPeersRef;

	// Custom restore event handler for debugging (currently unused)
	// const handleRestoreComplete = async (event) => {
	// 	console.log('🔄 Restore event received:', event.detail);
	// 	const { success, orbitdb, database, message } = event.detail;

	// 	if (success) {
	// 		console.log('🎉 Restore successful, updating application databases...');
	// 		console.log('🔍 New OrbitDB instance:', orbitdb);
	// 		console.log('🔍 New database instance:', database);

	// 		// Check if the restored database has entries
	// 		const restoredEntries = await database.all();
	// 		console.log('🔍 Restored database entries:', restoredEntries.length, restoredEntries);

	// 		// Manually update the stores
	// 		orbitdbStore.set(orbitdb);
	// 		todoDBStore.set(database);

	// 		// Force reload of todos from the new database
	// 		await loadTodos();

	// 		toastStore.show(`✅ Restore completed! ${restoredEntries.length} todos loaded.`, 'success');
	// 	} else {
	// 		console.error('❌ Restore failed:', message);
	// 		toastStore.show(`❌ Restore failed: ${message}`, 'error');
	// 	}
	// };

	// Add debugging to monitor store changes
	$: if ($orbitdbStore) {
		console.log('🔍 OrbitDB store changed:', $orbitdbStore.id || 'no-id');
	}

	$: if ($todoDBStore) {
		console.log('🔍 TodoDB store changed:', $todoDBStore.address || 'no-address');
	}

	$: if ($todosStore) {
		console.log('🔍 Todos store changed:', $todosStore.length, 'todos');
	}

	// Manual database debugging - expose to window for console debugging
	if (typeof window !== 'undefined') {
		window.debugDatabase = async () => {
			console.log('🔍 Current OrbitDB store:', $orbitdbStore?.id);
			console.log('🔍 Current TodoDB store:', $todoDBStore?.address);
			if ($todoDBStore) {
				const entries = await $todoDBStore.all();
				console.log('🔍 Current database entries:', entries.length, entries);
			}
			console.log('🔍 Current todos store:', $todosStore.length, $todosStore);
		};

		window.forceReloadTodos = async () => {
			console.log('🔄 Force reloading todos...');
			await loadTodos();
			console.log('🔄 Reload complete');
		};

		// refreshTodosFromServer already assigned at component load
	}
</script>

<SystemToast />

<svelte:head>
	<title
		>Simple TODO Example {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}</title
	>
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta
		name="description"
		content="A simple local-first peer-to-peer TODO list app using OrbitDB, IPFS and libp2p"
	/>
	<!-- Storacha Brand Fonts (Local) -->
	<link rel="stylesheet" href="/fonts/storacha-fonts.css" />
</svelte:head>

<!-- Only render the modal when needed -->
{#if showModal}
	<ConsentModal
		bind:show={showModal}
		title="Simple TODO Example"
		description="A local-first peer-to-peer web application demo"
		bind:rememberDecision
		rememberLabel="Don't show this again on this device"
		proceedButtonText="Proceed to Test the App"
		disabledButtonText="Please check all boxes to continue"
		on:proceed={handleModalClose}
	/>
{/if}

<main class="container mx-auto max-w-4xl p-6">
	<!-- Header with title and social icons -->
	<header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex-1">
			<h1 class="text-2xl font-bold text-gray-800 sm:text-3xl">Simple TODO Example</h1>
			<p class="mt-1 text-sm text-gray-500">
				• A Basic Local-First Peer-To-Peer PWA with IPFS and OrbitDB v{typeof __APP_VERSION__ !==
				'undefined'
					? __APP_VERSION__
					: '0.0.0'} [{typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]
			</p>
		</div>
		<div class="flex-shrink-0 self-start sm:self-auto">
			<SocialIcons size="w-5 h-5" className="" onQRCodeClick={() => (showQRCodeModal = true)} />
		</div>
	</header>

	{#if $initializationStore.isInitializing}
		<LoadingSpinner
			message={preferences.enableNetworkConnection
				? 'Initializing P2P connection...'
				: 'Opening OrbitDB database...'}
			submessage={$initializationStore.enableNetworkConnection
				? 'Please wait while we set up the network...'
				: 'Please wait while we open the database...'}
			version="{typeof __APP_VERSION__ !== 'undefined'
				? __APP_VERSION__
				: '0.0.0'} [{typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]"
		/>
	{:else if error || $initializationStore.error}
		<ErrorAlert error={error || $initializationStore.error} dismissible={true} />
	{:else}
		<!-- Add TODO Form -->
		<AddTodoForm on:add={handleAddTodo} disabled={$hybridMode?.mode !== 'server' && !$initializationStore.isInitialized} />

		<!-- TODO List -->
		<TodoList
			todos={$todosStore}
			on:delete={handleDelete}
			on:toggleComplete={handleToggleComplete}
		/>

		<!-- P2P Status -->
		<div class="grid gap-6 md:grid-cols-2">
			<!-- Connected Peers -->
			<ConnectedPeers bind:this={connectedPeersRef} libp2p={$libp2pStore} />

			<!-- My Identity -->
			<PeerIdCard peerId={myPeerId} />
		</div>

		<!-- Storacha Test Suite - Temporarily disabled
		<StorachaTest />
		-->
	{/if}
</main>

<!-- Floating Storacha Button & Panel - Always Available -->
<!-- Floating Storacha Button -->
<button
	on:click={async () => {
		if (!showStorachaIntegration) {
			await loadStorachaIntegration();
		}
		showStorachaIntegration = !showStorachaIntegration;
	}}
	class="fixed right-6 bottom-20 z-[10000] flex h-16 w-16 items-center justify-center rounded-full border-2 border-white bg-[#E91315] text-white shadow-2xl transition-all duration-300 hover:scale-110 hover:shadow-[0_20px_40px_rgba(233,19,21,0.4)] focus:ring-4 focus:ring-red-300 focus:outline-none {showStorachaIntegration
		? 'scale-105 rotate-12'
		: 'hover:rotate-6'}"
	title={showStorachaIntegration
		? 'Hide Spicy Storacha Backup 🌶️'
		: 'Open Storacha - The Hottest Decentralized Storage! Keep it Spicy! 🔥'}
	aria-label={showStorachaIntegration
		? 'Hide Storacha spicy backup integration'
		: 'Open Storacha spicy backup integration'}
	style="font-family: 'Epilogue', -apple-system, BlinkMacSystemFont, sans-serif; background: linear-gradient(135deg, #E91315 0%, #FFC83F 100%);"
>
	<!-- Official Storacha Rooster Logo -->
	<svg
		width="28"
		height="32"
		viewBox="0 0 154 172"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		class="transition-transform duration-300"
	>
		<path
			d="M110.999 41.5313H71.4081C70.2881 41.5313 69.334 42.4869 69.334 43.6087V154.359C69.334 159.461 69.1847 164.596 69.334 169.698C69.334 169.773 69.334 169.839 69.334 169.914C69.334 171.036 70.2881 171.992 71.4081 171.992H111.646C112.766 171.992 113.72 171.036 113.72 169.914V129.613L111.646 131.69H151.884C153.004 131.69 153.959 130.735 153.959 129.613V95.7513C153.959 91.6796 154.041 87.5996 153.942 83.5362C153.685 72.9996 149.512 62.8038 142.318 55.1091C135.125 47.4144 125.319 42.7029 114.907 41.7141C113.604 41.5894 112.302 41.5313 110.991 41.5313C108.319 41.523 108.319 45.6777 110.991 45.6861C120.772 45.7193 130.305 49.4171 137.457 56.1229C144.608 62.8287 149.022 71.9443 149.702 81.6416C149.993 85.813 149.802 90.0592 149.802 94.2306V124.677C149.802 126.231 149.694 127.826 149.802 129.38C149.802 129.455 149.802 129.53 149.802 129.604L151.876 127.527H111.638C110.518 127.527 109.564 128.483 109.564 129.604V169.906L111.638 167.829H71.3998L73.474 169.906V48.7689C73.474 47.1319 73.5818 45.4617 73.474 43.8247C73.474 43.7499 73.474 43.6834 73.474 43.6087L71.3998 45.6861H110.991C113.662 45.6861 113.662 41.5313 110.991 41.5313H110.999Z"
			fill="currentColor"
		/>
		<path
			d="M108.519 68.9694C108.452 62.9532 104.727 57.66 99.1103 55.5494C93.4935 53.4387 87.0886 55.2669 83.3718 59.779C79.5554 64.4157 78.9165 71.0966 82.0277 76.2901C85.1389 81.4836 91.2037 84.0762 97.1025 82.9544C103.723 81.6996 108.444 75.617 108.527 68.9694C108.56 66.2937 104.412 66.2937 104.379 68.9694C104.329 73.1325 101.749 77.0878 97.7579 78.4838C93.7673 79.8798 89.03 78.6749 86.3087 75.2265C83.5875 71.778 83.4879 67.2077 85.6865 63.6346C87.8851 60.0615 92.2076 58.1752 96.2811 59.0477C100.985 60.0532 104.32 64.1664 104.379 68.9777C104.412 71.6533 108.56 71.6533 108.527 68.9777L108.519 68.9694Z"
			fill="currentColor"
		/>
		<path
			d="M94.265 73.3237C96.666 73.3237 98.6124 71.3742 98.6124 68.9695C98.6124 66.5647 96.666 64.6152 94.265 64.6152C91.8641 64.6152 89.9177 66.5647 89.9177 68.9695C89.9177 71.3742 91.8641 73.3237 94.265 73.3237Z"
			fill="currentColor"
		/>
		<path
			d="M71.4081 36.8029H132.429C144.642 36.8029 150.64 28.5764 151.752 23.8981C152.863 19.2281 147.263 7.43685 133.624 22.1199C133.624 22.1199 141.754 6.32336 130.869 2.76686C119.984 -0.789637 107.473 10.1042 102.512 20.5577C102.512 20.5577 103.109 7.6529 91.8923 10.769C80.6754 13.8851 71.4081 36.7946 71.4081 36.7946V36.8029Z"
			fill="currentColor"
		/>
		<path
			d="M18.186 66.1195C17.879 66.0531 17.8707 65.6126 18.1694 65.5212C31.6927 61.4246 42.2376 70.7895 46.0457 76.6312C48.3189 80.1212 51.6956 83.3868 54.1182 85.5058C55.4042 86.6276 55.0889 88.7216 53.5292 89.4113C52.4589 89.8849 50.7498 90.9402 49.2316 91.846C46.3859 93.5495 42.4699 100.554 33.0948 101.884C26.1921 102.856 17.6716 98.7014 13.6561 96.4329C13.3408 96.2584 13.5399 95.793 13.8884 95.8761C19.8536 97.3137 24.2673 94.8291 22.4753 91.5302C21.1395 89.0706 17.5223 88.1482 12.2789 90.2339C7.61621 92.087 2.07414 86.0376 0.597357 84.2843C0.439724 84.1015 0.555875 83.8106 0.788177 83.7857C5.16044 83.3453 9.41656 78.8664 12.2291 74.1715C14.801 69.8755 20.5837 69.4849 22.4255 69.4683C22.6744 69.4683 22.8154 69.1858 22.6661 68.9863C22.0605 68.1886 20.6169 66.6513 18.186 66.1112V66.1195ZM30.1413 87.9571C29.7264 87.9322 29.4692 88.3975 29.7181 88.7299C30.7967 90.1342 33.5345 92.5855 38.7448 90.9818C45.8134 88.8047 46.1038 84.3175 40.9516 80.3455C36.4798 76.9054 29.2204 77.5618 24.8647 79.8968C24.4084 80.1461 24.5992 80.8441 25.1136 80.8026C26.8641 80.6696 30.133 80.8607 32.0827 82.2401C34.7126 84.0932 35.617 88.331 30.1413 87.9654V87.9571Z"
			fill="currentColor"
		/>
	</svg>
</button>

<!-- Floating Storacha Integration Panel -->
{#if showStorachaIntegration}
	<!-- Backdrop overlay -->
	<div
		class="fixed inset-0 z-[9998] bg-red-900/20 backdrop-blur-[2px]"
		on:click={() => (showStorachaIntegration = false)}
		on:keydown={(e) => e.key === 'Enter' && (showStorachaIntegration = false)}
		transition:fade={{ duration: 200 }}
		role="button"
		tabindex="0"
		aria-label="Close Storacha spicy integration panel"
		style="background: radial-gradient(circle at center, rgba(233, 19, 21, 0.15) 0%, rgba(233, 19, 21, 0.05) 70%, transparent 100%);"
	></div>

	<!-- Floating panel -->
	<div
		class="fixed right-6 bottom-36 z-[9999] w-96 max-w-[calc(100vw-3rem)] sm:right-4 sm:bottom-32 sm:w-80 md:right-6 md:bottom-36"
		transition:fly={{ x: 100, duration: 300 }}
	>
		<StorachaIntegration />
	</div>
{/if}

<!-- QR Code Modal -->
<QRCodeModal bind:show={showQRCodeModal} />

<!-- Hybrid Mode Indicator -->
<ModeIndicator />
