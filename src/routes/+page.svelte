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
	
	import QRCodeModal from '$lib/QRCodeModal.svelte';
	// import { Cloud } from 'lucide-svelte'; // Unused for now
	import { toastStore } from '$lib/toast-store.js';
	// Import hybrid mode detection
	import { initializeHybridMode, getHybridManager, hybridMode } from '$lib/hybrid-mode.js';
import { getFormInterceptor } from '$lib/form-interceptor.js';
import { browser } from '$app/environment';
	import CompactStatusBar from '$lib/CompactStatusBar.svelte';
	import ConnectedPeers from '$lib/ConnectedPeers.svelte';

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
					const forceClientMode = urlParams.get('mode') === 'client';
					
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
					} else if (forceClientMode) {
						console.log('🔄 Detected ?mode=client parameter - forcing client mode');
						// Clean up URL
						urlParams.delete('mode');
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
						toastStore.show('🌐 Running in P2P client mode', 'info');
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

	<!-- Compact Status Bar -->
	<CompactStatusBar />

	<!-- Connected Peers (only show when not initializing and no errors) -->
	{#if !$initializationStore.isInitializing && !error && !$initializationStore.error}
		<ConnectedPeers libp2p={$libp2pStore} title="Connected Peers" />
	{/if}

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
	{/if}
</main>
<!-- QR Code Modal -->
<QRCodeModal bind:show={showQRCodeModal} />

