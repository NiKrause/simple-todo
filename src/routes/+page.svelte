<script>
	/* eslint-disable no-undef */
	import { onMount } from 'svelte';
	import { peerIdStore, initializeP2P, initializationStore } from '$lib/p2p.js';
	import { todosStore, addTodo, deleteTodo, toggleTodoComplete } from '$lib/db-actions.js';
	import ConsentModal from '$lib/ConsentModal.svelte';
	import SocialIcons from '$lib/SocialIcons.svelte';
	import ToastNotification from '$lib/ToastNotification.svelte';
	import LoadingSpinner from '$lib/LoadingSpinner.svelte';
	import ErrorAlert from '$lib/ErrorAlert.svelte';
	import AddTodoForm from '$lib/AddTodoForm.svelte';
	import TodoList from '$lib/TodoList.svelte';
	import ConnectedPeers from '$lib/ConnectedPeers.svelte';
	import PeerIdCard from '$lib/PeerIdCard.svelte';
	import StorachaIntegration from '$lib/StorachaIntegration.svelte';
	import { libp2pStore } from '$lib/p2p.js';

	const CONSENT_KEY = `consentAccepted@${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}`;

	let toastMessage = null;
	let toastType = 'default';
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

	function showToast(message, type = 'default') {
		toastMessage = message;
		toastType = type;
		setTimeout(() => {
			toastMessage = null;
		}, 3000);
	}

	const handleAddTodo = async (event) => {
		const success = await addTodo(event.detail.text);
		if (success) {
			showToast('✅ Todo added successfully!', 'success');
		} else {
			showToast('❌ Failed to add todo', 'error');
		}
	};

	const handleDelete = async (event) => {
		const success = await deleteTodo(event.detail.key);
		if (success) {
			showToast('🗑️ Todo deleted successfully!', 'success');
		} else {
			showToast('❌ Failed to delete todo', 'error');
		}
	};

	const handleToggleComplete = async (event) => {
		const success = await toggleTodoComplete(event.detail.key);
		if (success) {
			showToast('✅ Todo status updated!', 'success');
		} else {
			showToast('❌ Failed to update todo', 'error');
		}
	};

	// Subscribe to the peerIdStore
	$: myPeerId = $peerIdStore;

	let connectedPeersRef;
</script>

<ToastNotification message={toastMessage} type={toastType} />

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
			<SocialIcons size="w-5 h-5" className="" />
		</div>
	</header>

	{#if $initializationStore.isInitializing}
		<LoadingSpinner
			message={preferences.enableNetworkConnection ? "Initializing P2P connection..." : "Opening OrbitDB database..."}
			submessage={$initializationStore.enableNetworkConnection ? "Please wait while we set up the network..." : "Please wait while we open the database..."}
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

		<!-- Storacha Integration -->
		<StorachaIntegration />
	{/if}
</main>
