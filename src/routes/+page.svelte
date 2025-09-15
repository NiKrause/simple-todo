<script>
	/* eslint-disable no-undef */
	import { onMount } from 'svelte';
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
	import StorachaIntegration from '$lib/StorachaIntegration.svelte';
	import QRCodeModal from '$lib/QRCodeModal.svelte';
	import { Cloud } from 'lucide-svelte';
	import { toastStore } from '$lib/toast-store.js';

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
			// Pass the preferences to initializeP2P
			await initializeP2P(preferences);
		} catch (err) {
			error = `Failed to initialize P2P or OrbitDB: ${err.message}`;
			console.error('P2P initialization failed:', err);
		}
	};

	onMount(async () => {
		try {
			if (localStorage.getItem(CONSENT_KEY) === 'true') {
				showModal = false;
				// When auto-initializing, use default preferences
				console.log('🔧 DEBUG: Auto-initializing with default preferences');
				await initializeP2P({
					enablePersistentStorage: true,
					enableNetworkConnection: true,
					enablePeerConnections: true
				});
			}
		} catch {
			// ignore storage errors
		}
	});

	const handleAddTodo = async (event) => {
		const success = await addTodo(event.detail.text);
		if (success) {
			toastStore.show('✅ Todo added successfully!', 'success');
		} else {
			toastStore.show('❌ Failed to add todo', 'error');
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
		<AddTodoForm on:add={handleAddTodo} disabled={!$initializationStore.isInitialized} />

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
<!-- Floating Cloud Button -->
<button
	on:click={() => (showStorachaIntegration = !showStorachaIntegration)}
	class="fixed right-6 bottom-6 z-[10000] flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-purple-600 text-white shadow-lg transition-all duration-300 hover:scale-110 hover:shadow-xl focus:ring-4 focus:ring-blue-300 focus:outline-none {showStorachaIntegration
		? 'rotate-180'
		: ''}"
	title={showStorachaIntegration
		? 'Hide Cloud Backup'
		: 'Open Storacha Gateway Integration for Decentralized Filecoin Storage Backup'}
	aria-label={showStorachaIntegration
		? 'Hide Storacha cloud backup integration'
		: 'Open Storacha cloud backup integration'}
>
	<Cloud class="h-6 w-6 transition-transform duration-300" />
</button>

<!-- Floating Storacha Integration Panel -->
{#if showStorachaIntegration}
	<!-- Backdrop overlay -->
	<div
		class="fixed inset-0 z-[9998] bg-black/10 backdrop-blur-[1px]"
		on:click={() => (showStorachaIntegration = false)}
		on:keydown={(e) => e.key === 'Enter' && (showStorachaIntegration = false)}
		transition:fade={{ duration: 200 }}
		role="button"
		tabindex="0"
		aria-label="Close Storacha integration panel"
	></div>

	<!-- Floating panel -->
	<div
		class="fixed right-6 bottom-24 z-[9999] w-96 max-w-[calc(100vw-3rem)] sm:right-4 sm:bottom-20 sm:w-80 md:right-6 md:bottom-24"
		transition:fly={{ x: 100, duration: 300 }}
	>
		>
		<StorachaIntegration />
	</div>
{/if}

<!-- QR Code Modal -->
<QRCodeModal bind:show={showQRCodeModal} />
