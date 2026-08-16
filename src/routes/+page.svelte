<script>
	import { onMount } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import LanguageSwitcher from '$lib/LanguageSwitcher.svelte';
	import ViewModeToggle from '$lib/ViewModeToggle.svelte';
	import { simpleView, hydrateViewMode } from '$lib/view-mode.js';
	import { peerIdStore, initializeP2P, initializationStore, restartP2P } from '$lib/p2p.js';
	import IdentityPanel from '$lib/IdentityPanel.svelte';
	import QrTransfer from '$lib/QrTransfer.svelte';
	import { qrCodeOnScreen } from '$lib/qr-transport.js';
	import ListOfferDialog from '$lib/ListOfferDialog.svelte';
	import {
		todosStore,
		todoDBAddressStore,
		activeListStore,
		addTodo,
		deleteTodo,
		toggleTodoComplete
	} from '$lib/db-actions.js';
	import { formatVersions } from '$lib/build-info.js';
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
	import ListSwitcher from '$lib/ListSwitcher.svelte';
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

	/**
	 * Switch the shared list without a modal in the way.
	 *
	 * The mnemonic used to be chosen on the consent screen, which meant changing
	 * it required bringing that screen back. It is an in-app action now, like
	 * every other list operation in this chapter.
	 */
	const applyMnemonic = async () => {
		if (!mnemonicValid) return;
		const canonicalMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
		selectedMnemonic = canonicalMnemonic;
		try {
			localStorage.setItem(SPANISH_MNEMONIC_STORAGE_KEY, canonicalMnemonic);
		} catch {
			// ignore storage errors
		}
		try {
			await restartP2P({ todoDbName: canonicalMnemonic });
			activeMnemonic = canonicalMnemonic;
		} catch (err) {
			error = `Failed to switch list: ${err instanceof Error ? err.message : String(err)}`;
			console.error('Shared list switch failed:', err);
		}
	};

	onMount(async () => {
		hydrateViewMode();
		// Straight into the app: no consent screen, nothing to dismiss, no
		// decision required before anything works. This chapter is used on a
		// construction site with a phone in one hand, and the previous chapters'
		// modal was three interactions in front of a list.
		//
		// Anonymous, because an unattended start cannot do anything else:
		// WebAuthn refuses to run outside a user gesture, and `onMount` is not
		// one. An anonymous OrbitDB identity is still an identity — it owns the
		// private lists it creates and gives them their unguessable address —
		// so upgrading to a passkey is an offer in `IdentityPanel`, not a toll
		// gate here.
		let mnemonic = '';
		try {
			mnemonic = loadOrGenerateMnemonic();
			selectedMnemonic = mnemonic;
		} catch {
			// Storage unavailable: fall through with a session-only mnemonic.
			mnemonic = normalizeSpanishMnemonic(generateSpanishMnemonic());
			selectedMnemonic = mnemonic;
		}

		try {
			activeMnemonic = normalizeSpanishMnemonic(mnemonic);
			await initializeP2P({ todoDbName: activeMnemonic, passkeyCredential: null });
		} catch (err) {
			error = `Failed to initialize P2P: ${err instanceof Error ? err.message : String(err)}`;
			console.error('P2P initialization failed:', err);
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
	let showMnemonicEditor = false;
	/** @type {'create' | 'open'} */
	let listTab = 'create';
</script>

<ToastNotification message={toastMessage} type={toastType} />
<ListOfferDialog />

<svelte:head>
	<title>Simple-Todo {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}</title>
	<meta name="viewport" content="width=device-width, initial-scale=1.0" />
	<meta
		name="description"
		content="A simple local-first peer-to-peer TODO list app using OrbitDB, IPFS and libp2p"
	/>
</svelte:head>

<main class="container mx-auto max-w-4xl p-6">
	<!-- Header with title and social icons -->
	<header class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex flex-1 items-center gap-3">
			<LeSpaceLogo size={52} />
			<div>
				<h1 class="text-2xl font-bold text-heading sm:text-3xl">{$_('app.title')}</h1>
				<!--
					What this is *for*, in the simple view; what it is *built from* in
					the technical one. The version string is the first thing on the
					page, and to anyone who is not going to file a bug report it is a
					wall of words that mean nothing — a poor way to be greeted.
				-->
				<p class="mt-1 text-sm text-faint">
					{#if $simpleView}
						{$_('app.tagline')}
					{:else}
						A local-first peer-to-peer PWA · {formatVersions({
							appName: 'Simple-Todo'
						})} · {typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'local'} [{typeof __BUILD_DATE__ !==
						'undefined'
							? __BUILD_DATE__
							: 'dev'}]
					{/if}
				</p>
			</div>
		</div>
		<!-- The DID moved into the status panel, next to the control that
		     produces it. Announcing it up here left the identity split across
		     two ends of the page. -->
		<div class="flex flex-shrink-0 items-center gap-2 self-start sm:self-auto">
			<LanguageSwitcher />
			<ViewModeToggle />
			<ThemeToggle />
			{#if !$simpleView}
				<SocialIcons size="w-5 h-5" className="" />
			{/if}
		</div>
	</header>

	<!--
		Simple view: one line saying whether the app is ready, and the identity
		panel — the only part of this box a first-time user has any use for.
		Everything else here answers "did libp2p come up", which is a question
		only someone debugging asks, and it answered it with seven dots labelled
		`Helia`, `OrbitDB` and `12D3KooW…`.

		Nothing is removed; `P2PStatusNav` returns intact in the technical view.
	-->
	{#if $simpleView}
		<div class="mb-4 rounded-lg border border-border bg-surface p-4" data-testid="simple-status">
			<p class="text-sm font-medium text-text" data-testid="simple-status-line">
				{#if $initializationStore.error}
					{$_('status.failed')}
				{:else if $initializationStore.isInitialized}
					{$_('status.ready')}
				{:else}
					{$_('status.starting')}
				{/if}
			</p>
			<div class="mt-3">
				<IdentityPanel />
			</div>
		</div>
	{:else}
		<P2PStatusNav initialization={$initializationStore} libp2p={$libp2pStore} peerId={myPeerId}>
			<svelte:fragment slot="identity">
				<IdentityPanel />
			</svelte:fragment>
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
						activeList={$activeListStore}
						on:change={() => (showMnemonicEditor = !showMnemonicEditor)}
					/>
					{#if showMnemonicEditor}
						<div class="mt-2 space-y-2" data-testid="shared-list-editor">
							<SharedListSelector bind:value={selectedMnemonic} />
							<button
								type="button"
								class="rounded bg-cyan-600 px-2 py-1 text-xs text-white hover:bg-cyan-700 disabled:opacity-50"
								disabled={!mnemonicValid}
								on:click={applyMnemonic}
								data-testid="shared-list-apply">Open this list</button
							>
						</div>
					{/if}
				{/if}
			</svelte:fragment>
		</P2PStatusNav>
	{/if}

	{#if error || $initializationStore.error}
		<ErrorAlert error={error || $initializationStore.error} dismissible={true} />
	{/if}

	{#if $initializationStore.isInitialized}
		<QrTransfer />

		<!--
			Two ways to end up with a list, as two tabs rather than two stacked
			panels. They are alternatives — you either make one or you open
			somebody else's — and stacking them made the page read as a checklist
			of things to do rather than a choice between two.

			"Create" is the default, and your existing lists live inside it: that
			is where you look for a list you already have, right under the control
			that makes new ones.
		-->
		<section
			class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
			data-testid="list-tabs"
		>
			<div class="flex gap-1 border-b border-border" role="tablist">
				{#each [{ id: 'create', label: $_('tabs.create') }, { id: 'open', label: $_('tabs.open') }] as tab (tab.id)}
					<button
						type="button"
						role="tab"
						aria-selected={listTab === tab.id}
						on:click={() => (listTab = tab.id)}
						data-testid="list-tab-{tab.id}"
						class="-mb-px border-b-2 px-3 py-1.5 text-xs font-medium
							{listTab === tab.id
							? 'border-cyan-600 text-heading'
							: 'border-transparent text-faint hover:text-text'}"
					>
						{tab.label}
					</button>
				{/each}
			</div>

			<div class="mt-3">
				{#if listTab === 'create'}
					<NewPrivateListButton />
					<ListSwitcher />
				{:else}
					<OpenDatabaseForm />
				{/if}
			</div>
		</section>

		<PermissionsPanel />
	{/if}

	<!-- Add TODO Form -->
	<AddTodoForm on:add={handleAddTodo} disabled={!$initializationStore.isInitialized} />

	<!-- TODO List -->
	<TodoList todos={$todosStore} on:delete={handleDelete} on:toggleComplete={handleToggleComplete} />
</main>

<!--
	The Relay Button, out of the way while a code is being scanned.

	It renders itself `position: fixed` at bottom-right with `z-index: 10000`,
	so it sat squarely on top of the QR code — covering part of a code someone
	is holding up to a camera, which is the one interaction this chapter exists
	for. A wrapper cannot move it (fixed elements ignore their container) and
	overriding the position with `!important` would be fighting the component,
	so it simply is not drawn for the few seconds a code is up.

	It is also the least relevant control here until milestone 3 adds a relay,
	which is the other half of "less intrusive than in the earlier chapters".
-->
{#if !$qrCodeOnScreen && !$simpleView}
	<div data-testid="relay-button-slot">
		<SponsorRelayFab manifestUrl="./rootfs-manifest.json" showInstances={true} />
	</div>
{/if}
