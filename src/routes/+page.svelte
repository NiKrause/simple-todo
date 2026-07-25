<script>
	/* eslint-disable no-undef */
	import { onMount } from 'svelte';
	import { peerIdStore, ownDidStore, initializeP2P, initializationStore, restartP2P } from '$lib/p2p.js';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import DidBadge from '$lib/DidBadge.svelte';
	import { createPasskeyCredential, recoverPasskeyCredential } from '$lib/passkey-identity.js';
	import {
		todosStore,
		todoDBAddressStore,
		addTodo,
		deleteTodo,
		toggleTodoComplete
	} from '$lib/db-actions.js';
	import ConsentModal from '$lib/ConsentModal.svelte';
	import SocialIcons from '$lib/SocialIcons.svelte';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import LeSpaceLogo from '$lib/LeSpaceLogo.svelte';
	import ToastNotification from '$lib/ToastNotification.svelte';
	import P2PStatusNav from '$lib/P2PStatusNav.svelte';
	import ErrorAlert from '$lib/ErrorAlert.svelte';
	import AddTodoForm from '$lib/AddTodoForm.svelte';
	import TodoList from '$lib/TodoList.svelte';
	import ConnectedPeers from '$lib/ConnectedPeers.svelte';
	import PeerIdCard from '$lib/PeerIdCard.svelte';
	import OwnMultiaddrs from '$lib/OwnMultiaddrs.svelte';
	import SharedListSelector from '$lib/SharedListSelector.svelte';
	import SharedListDetails from '$lib/SharedListDetails.svelte';
	import PermissionsPanel from '$lib/PermissionsPanel.svelte';
	import OpenDatabaseForm from '$lib/OpenDatabaseForm.svelte';
	import NewPrivateListButton from '$lib/NewPrivateListButton.svelte';
	import {
		SPANISH_MNEMONIC_STORAGE_KEY,
		generateSpanishMnemonic,
		isValidSpanishMnemonic,
		normalizeSpanishMnemonic
	} from '$lib/spanish-mnemonic.js';
	import ManualConnectForm from '$lib/ManualConnectForm.svelte';
	import { libp2pStore } from '$lib/p2p.js';
	import SponsorRelayFab from '@le-space/ui/svelte';

	/** @typedef {'default' | 'success' | 'error' | 'warning'} ToastType */
	/** @typedef {{ detail: { text: string } }} AddTodoEvent */
	/** @typedef {{ detail: { key: string } }} TodoActionEvent */

	const CONSENT_KEY = `consentAccepted@${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}`;
	const IDENTITY_MODE_KEY = 'simpleTodo.identityMode';

	/** @type {'create' | 'existing' | 'anonymous'} */
	let identityMode = 'anonymous';
	let passkeyUserId = '';
	let passkeyDisplayName = '';

	/** @type {string | null} */
	let toastMessage = null;
	/** @type {ToastType} */
	let toastType = 'default';
	/** @type {string | null} */
	let error = null;
	/** @type {string | null} */
	let myPeerId = null;
	let selectedMnemonic = '';
	let activeMnemonic = '';
	$: mnemonicValid = isValidSpanishMnemonic(selectedMnemonic);

	// Modal state
	let showModal = true;
	let rememberDecision = false;

	const handleModalClose = async () => {
		const canonicalMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
		selectedMnemonic = canonicalMnemonic;
		try {
			localStorage.setItem(SPANISH_MNEMONIC_STORAGE_KEY, canonicalMnemonic);
			if (rememberDecision) {
				localStorage.setItem(CONSENT_KEY, 'true');
			}
		} catch {
			// ignore storage errors
		}
		try {
			// Resolve the identity choice first — WebAuthn calls must run inside
			// the user gesture of the proceed click.
			let passkeyCredential = null;
			if (identityMode === 'create') {
				if (!passkeyUserId.trim() || !passkeyDisplayName.trim()) {
					throw new Error('Please enter a user id and display name for the new passkey.');
				}
				passkeyCredential = await createPasskeyCredential({
					userId: passkeyUserId.trim(),
					displayName: passkeyDisplayName.trim()
				});
			} else if (identityMode === 'existing') {
				passkeyCredential = await recoverPasskeyCredential();
				if (!passkeyCredential) {
					throw new Error(
						'No passkey found for this origin. Create a new one or continue without a passkey.'
					);
				}
			}
			try {
				localStorage.setItem(IDENTITY_MODE_KEY, passkeyCredential ? 'passkey' : 'anon');
			} catch {
				// ignore storage errors
			}

			if ($initializationStore.isInitialized) {
				await restartP2P({ todoDbName: canonicalMnemonic });
			} else {
				await initializeP2P({ todoDbName: canonicalMnemonic, passkeyCredential });
			}
			activeMnemonic = canonicalMnemonic;
		} catch (err) {
			showModal = true;
			error = `Failed to initialize P2P: ${err instanceof Error ? err.message : String(err)}`;
			console.error('P2P initialization failed:', err);
		}
	};

	onMount(async () => {
		try {
			selectedMnemonic = loadOrGenerateMnemonic();
			const rememberedIdentityMode = localStorage.getItem(IDENTITY_MODE_KEY);
			if (rememberedIdentityMode === 'passkey') {
				// A WebAuthn prompt needs a user gesture, so a remembered passkey
				// session cannot auto-start: preselect recovery and show the modal.
				identityMode = 'existing';
			} else if (localStorage.getItem(CONSENT_KEY) === 'true') {
				showModal = false;
				activeMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
				await initializeP2P({ todoDbName: activeMnemonic, passkeyCredential: null });
			}
		} catch {
			// ignore storage errors
		}
	});

	function loadOrGenerateMnemonic() {
		try {
			const saved = localStorage.getItem(SPANISH_MNEMONIC_STORAGE_KEY);
			if (saved && isValidSpanishMnemonic(saved)) return normalizeSpanishMnemonic(saved);
		} catch {
			// Continue with an in-memory mnemonic when browser storage is unavailable.
		}
		const generated = generateSpanishMnemonic();
		try {
			localStorage.setItem(SPANISH_MNEMONIC_STORAGE_KEY, generated);
		} catch {
			// The generated value remains usable for this session.
		}
		return generated;
	}

	/**
	 * @param {string} message
	 * @param {ToastType} [type='default']
	 */
	function showToast(message, type = 'default') {
		toastMessage = message;
		toastType = type;
		setTimeout(() => {
			toastMessage = null;
		}, 3000);
	}

	/**
	 * @param {AddTodoEvent} event
	 */
	const handleAddTodo = async (event) => {
		const result = await addTodo(event.detail.text);
		if (result.ok) {
			showToast('✅ Todo added successfully!', 'success');
		} else {
			showToast(`❌ ${result.error ?? 'Failed to add todo'}`, 'error');
		}
	};

	/**
	 * @param {TodoActionEvent} event
	 */
	const handleDelete = async (event) => {
		const success = await deleteTodo(event.detail.key);
		if (success) {
			showToast('🗑️ Todo deleted successfully!', 'success');
		} else {
			showToast('❌ Failed to delete todo', 'error');
		}
	};

	/**
	 * @param {TodoActionEvent} event
	 */
	const handleToggleComplete = async (event) => {
		const success = await toggleTodoComplete(event.detail.key);
		if (success) {
			showToast('✅ Todo status updated!', 'success');
		} else {
			showToast('❌ Failed to update todo', 'error');
		}
	};

	/**
	 * @param {{ detail: { status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string } }} event
	 */
	const handleManualConnect = (event) => {
		const peerTarget = event.detail.remotePeer || event.detail.remoteAddr;

		if (event.detail.status === 'stable') {
			showToast(`🔗 Connected to ${peerTarget}`, 'success');
			return;
		}

		showToast(`⚠️ ${peerTarget} closed the connection shortly after connect`, 'warning');
	};

	// Subscribe to the peerIdStore
	$: myPeerId = $peerIdStore;

	let connectedPeersRef;
</script>

<ToastNotification message={toastMessage} type={toastType} />

<svelte:head>
	<title
		>Simple-Todo {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}</title
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
		title="Simple-Todo"
		bind:rememberDecision
		rememberLabel="Don't show this again on this device"
		proceedButtonText="Open shared list"
		disabledButtonText="Please check all boxes to continue"
		canProceed={mnemonicValid}
		on:proceed={handleModalClose}
	>
		<svelte:fragment slot="before-confirmation">
			<SharedListSelector bind:value={selectedMnemonic} />
			<PasskeyOnboarding
				bind:mode={identityMode}
				bind:userId={passkeyUserId}
				bind:displayName={passkeyDisplayName}
			/>
		</svelte:fragment>
	</ConsentModal>
{/if}

<main class="container mx-auto max-w-4xl p-6">
	<!-- Header with title and social icons -->
	<header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex flex-1 items-center gap-3">
			<LeSpaceLogo size={52} />
			<div>
				<h1 class="text-2xl font-bold text-heading sm:text-3xl">Simple-Todo</h1>
				<p class="mt-1 text-sm text-faint">
					A local-first peer-to-peer PWA · IPFS + OrbitDB v{typeof __APP_VERSION__ !== 'undefined'
						? __APP_VERSION__
						: '0.0.0'} · {typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'local'} [{typeof __BUILD_DATE__ !==
					'undefined'
						? __BUILD_DATE__
						: 'dev'}]
				</p>
			</div>
		</div>
		<div class="flex flex-shrink-0 items-center gap-2 self-start sm:self-auto">
			<DidBadge did={$ownDidStore ?? ''} />
			<ThemeToggle />
			<SocialIcons size="w-5 h-5" className="" />
		</div>
	</header>

	<P2PStatusNav initialization={$initializationStore} libp2p={$libp2pStore} peerId={myPeerId}>
		<ManualConnectForm
			compact
			disabled={!$initializationStore.isInitialized}
			on:connected={handleManualConnect}
		/>
		<ConnectedPeers compact bind:this={connectedPeersRef} libp2p={$libp2pStore} />
		<div class="max-w-full min-w-0 space-y-3 overflow-hidden">
			<PeerIdCard compact peerId={myPeerId} />
			<OwnMultiaddrs libp2p={$libp2pStore} />
		</div>
		<svelte:fragment slot="shared-list">
			{#if $initializationStore.isInitialized && activeMnemonic}
				<SharedListDetails
					embedded
					mnemonic={activeMnemonic}
					databaseAddress={$todoDBAddressStore}
					on:change={() => {
						selectedMnemonic = activeMnemonic;
						showModal = true;
					}}
				/>
			{/if}
		</svelte:fragment>
	</P2PStatusNav>

	{#if error || $initializationStore.error}
		<ErrorAlert error={error || $initializationStore.error} dismissible={true} />
	{/if}

	{#if $initializationStore.isInitialized}
		<NewPrivateListButton />
		<OpenDatabaseForm />
		<PermissionsPanel />
	{/if}

	<!-- Add TODO Form -->
	<AddTodoForm on:add={handleAddTodo} disabled={!$initializationStore.isInitialized} />

	<!-- TODO List -->
	<TodoList todos={$todosStore} on:delete={handleDelete} on:toggleComplete={handleToggleComplete} />
</main>

<!-- Floating Relay Button FAB -->
<SponsorRelayFab manifestUrl="./rootfs-manifest.json" showInstances={true} />
