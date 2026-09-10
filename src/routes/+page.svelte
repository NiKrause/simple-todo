<script>
	import { onMount } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { peerIdStore, initializationStore, ownDidStore } from '$lib/p2p-stores.js';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import DidBadge from '$lib/DidBadge.svelte';
	import { createPasskeyCredential, recoverPasskeyCredential } from '$lib/passkey-identity.js';
	import {
		todosStore,
		todoDBStore,
		todoDBAddressStore,
		activeListStore,
		ownIdentityIdStore,
		addTodo,
		deleteTodo,
		toggleTodoComplete,
		updateTodoText,
		delegateTodo,
		revokeTodoDelegation
	} from '$lib/db-actions.js';
	import { supportsDelegation } from '$lib/delegated-access.js';
	import DelegatedAuthBadge from '$lib/DelegatedAuthBadge.svelte';
	import { formatVersions } from '$lib/build-info.js';
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
	import StorageModeSelector from '$lib/StorageModeSelector.svelte';
	import { getPersistentStorageEnabled } from '$lib/storage-mode.js';
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
	import { libp2pStore } from '$lib/p2p-stores.js';

	/** @typedef {'default' | 'success' | 'error' | 'warning'} ToastType */
	/** @typedef {{ detail: { text: string, delegateDid?: string | null, delegationExpiresAt?: string | null } }} AddTodoEvent */
	/** @typedef {{ detail: { key: string } }} TodoActionEvent */
	/** @typedef {{ detail: { key: string, text: string } }} UpdateTextEvent */
	/** @typedef {{ detail: { key: string, delegateDid: string, expiresAt: string | null } }} DelegateEvent */

	const CONSENT_KEY = `consentAccepted@${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}`;
	const IDENTITY_MODE_KEY = 'simpleTodo.identityMode';

	/** @type {'create' | 'existing' | 'anonymous'} */
	let identityMode = 'anonymous';
	let passkeyLabel = '';

	/** @type {string | null} */
	let toastMessage = null;
	/** @type {ToastType} */
	let toastType = 'default';
	/** @type {string | null} */
	let error = null;
	/** @type {string | null} */
	let notice = null;
	/*
		Seeded from the stored preference, not from a literal. With `bind:mode`
		the parent's initial value wins, so a hard-coded 'memory' here overwrote
		what the person chose last time — and the selector's reactive write then
		persisted that overwrite. A reload silently moved everyone back to
		in-memory, which is exactly the failure the storage choice exists to fix.
	*/
	/** @type {'memory' | 'indexeddb'} */
	let storageMode = getPersistentStorageEnabled() ? 'indexeddb' : 'memory';
	/** @type {string | null} */
	let myPeerId = null;
	let selectedMnemonic = '';
	let activeMnemonic = '';
	$: mnemonicValid = isValidSpanishMnemonic(selectedMnemonic);

	// Modal state
	let showModal = true;
	let rememberDecision = false;

	/**
	 * A choice the person made that cannot be carried out — no passkey behind
	 * "use an existing one", an unnamed new one. Separated from a genuine
	 * startup failure because the two need different words: this one is
	 * answered by choosing differently, and prefixing it with "P2P" only hides
	 * that.
	 */
	class IdentityChoiceError extends Error {}

	/**
	 * The passkey binds the identity only as far as the authenticator lets it.
	 *
	 * `ensureDerivedSigningKey` derives the OrbitDB signing key from the
	 * credential's PRF output, which is what makes the same passkey produce the
	 * same identity document everywhere. Without PRF it is never fatal: the
	 * keystore generates its own key, the DID stays the same, and the public
	 * key differs per device. The provider logs one debug line, so nothing
	 * reaches the person it affects. This does.
	 *
	 * @param {any} credential
	 */
	function warnIfIdentityCannotTravel(credential) {
		if (!credential || credential.extensionSupport?.prf !== false) return;
		const seen = `simpleTodo.prfWarned.${credential.credentialId ?? 'unknown'}`;
		try {
			if (localStorage.getItem(seen) === 'true') return;
			localStorage.setItem(seen, 'true');
		} catch {
			// No storage: warn every time rather than not at all.
		}
		showToast($_('consent.prfMissing'), 'warning', 12_000);
	}

	const handleModalClose = async () => {
		// The dialog shows this now, so a stale one would accuse the attempt that
		// is only just starting.
		error = null;
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
				if (!passkeyLabel.trim()) {
					throw new IdentityChoiceError($_('consent.errorNeedsLabel'));
				}
				// The same label goes into both WebAuthn fields on purpose: they are
				// the account name and the display name of one credential, and the
				// picker shows them together. Neither identifies the passkey.
				passkeyCredential = await createPasskeyCredential({
					userId: passkeyLabel.trim(),
					displayName: passkeyLabel.trim()
				});
			} else if (identityMode === 'existing') {
				passkeyCredential = await recoverPasskeyCredential();
				if (!passkeyCredential) {
					throw new IdentityChoiceError($_('consent.errorNoPasskey'));
				}
			}
			try {
				localStorage.setItem(IDENTITY_MODE_KEY, passkeyCredential ? 'passkey' : 'anon');
			} catch {
				// ignore storage errors
			}

			if ($initializationStore.isInitialized) {
				await restartP2PLazy({ todoDbName: canonicalMnemonic });
			} else {
				await startP2P({ todoDbName: canonicalMnemonic, passkeyCredential });
			}
			activeMnemonic = canonicalMnemonic;
			warnIfIdentityCannotTravel(passkeyCredential);
		} catch (err) {
			showModal = true;
			const reason = err instanceof Error ? err.message : String(err);
			error =
				err instanceof IdentityChoiceError
					? reason
					: $_('consent.errorStart', { values: { reason } });
			console.error('P2P initialization failed:', err);
		}
	};

	// Loaded on demand, not at page load. `p2p.js` pulls libp2p, Helia, OrbitDB
	// and gossipsub, and none of it is needed to render the consent dialog —
	// the only thing on screen until the user agrees.
	async function startP2P(/** @type {any} */ options) {
		void loadSponsorFab();
		const { initializeP2P } = await import('$lib/p2p.js');
		await initializeP2P(options);
	}

	async function restartP2PLazy(/** @type {any} */ options) {
		const { restartP2P } = await import('$lib/p2p.js');
		await restartP2P(options);
	}

	// The largest single thing this app ships, and the whole Aleph deployment
	// machinery rides with it. It lives inside the network panel behind the
	// consent dialog, so a static import made every visitor download a relay
	// deployer before they could read the dialog.
	/** @type {any} */
	let SponsorRelayFab = null;
	async function loadSponsorFab() {
		if (SponsorRelayFab) return;
		SponsorRelayFab = (await import('@le-space/ui/svelte')).default;
	}

	onMount(async () => {
		try {
			selectedMnemonic = loadOrGenerateMnemonic();
			const rememberedIdentityMode = localStorage.getItem(IDENTITY_MODE_KEY);
			if (rememberedIdentityMode === 'passkey') {
				// A WebAuthn prompt needs a user gesture, so a remembered passkey
				// session cannot auto-start: preselect recovery and show the modal.
				identityMode = 'existing';
				notice = $_('consent.existingNeedsTap');
			} else if (localStorage.getItem(CONSENT_KEY) === 'true') {
				showModal = false;
				activeMnemonic = normalizeSpanishMnemonic(selectedMnemonic);
				await startP2P({ todoDbName: activeMnemonic, passkeyCredential: null });
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
	/** @type {ReturnType<typeof setTimeout> | null} */
	let toastTimer = null;
	let toastDuration = 3000;

	/**
	 * Three seconds fits "Todo added". It does not fit two sentences about what
	 * an authenticator cannot do, so the duration is the caller's to say.
	 *
	 * @param {string} message
	 * @param {ToastType} [type]
	 * @param {number} [duration] milliseconds on screen
	 */
	function showToast(message, type = 'default', duration = 3000) {
		toastMessage = message;
		toastType = type;
		// The component auto-hides on its own timer, so it has to hear the same
		// number — otherwise it disappears after its default three seconds.
		toastDuration = duration;
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toastMessage = null;
			toastTimer = null;
		}, duration);
	}

	/**
	 * @param {AddTodoEvent} event
	 */
	const handleAddTodo = async (event) => {
		const { text, delegateDid, delegationExpiresAt } = event.detail;
		const result = await addTodo(text, null, {
			delegateDid: delegateDid ?? null,
			expiresAt: delegationExpiresAt ?? null
		});
		if (result.ok) {
			showToast(
				delegateDid ? '✅ Todo added and delegated!' : '✅ Todo added successfully!',
				'success'
			);
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
		const result = await toggleTodoComplete(event.detail.key);
		if (result.ok) {
			showToast('✅ Todo status updated!', 'success');
		} else {
			showToast(`❌ ${result.error ?? 'Failed to update todo'}`, 'error');
		}
	};

	/** @param {UpdateTextEvent} event */
	const handleUpdateText = async (event) => {
		const result = await updateTodoText(event.detail.key, event.detail.text);
		showToast(
			result.ok ? '✅ Todo renamed!' : `❌ ${result.error ?? 'Failed to rename todo'}`,
			result.ok ? 'success' : 'error'
		);
	};

	/** @param {DelegateEvent} event */
	const handleDelegate = async (event) => {
		const { key, delegateDid, expiresAt } = event.detail;
		const result = await delegateTodo(key, { delegateDid, expiresAt });
		showToast(
			result.ok ? '🤝 Todo delegated!' : `❌ ${result.error ?? 'Failed to delegate todo'}`,
			result.ok ? 'success' : 'error'
		);
	};

	/** @param {TodoActionEvent} event */
	const handleRevokeDelegation = async (event) => {
		const result = await revokeTodoDelegation(event.detail.key);
		showToast(
			result.ok ? '↩️ Delegation revoked' : `❌ ${result.error ?? 'Failed to revoke delegation'}`,
			result.ok ? 'success' : 'error'
		);
	};

	// delegation01: the shared mnemonic list (IPFS controller) cannot take
	// delegations; private lists and lists opened by address can.
	$: delegationEnabled = supportsDelegation($todoDBStore);

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

<ToastNotification message={toastMessage} type={toastType} duration={toastDuration} />

<svelte:head>
	<title>Simple-Todo {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}</title>
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
		bind:rememberDecision
		canProceed={mnemonicValid}
		identity={identityMode}
		storage={storageMode}
		{error}
		{notice}
		on:proceed={handleModalClose}
	>
		<svelte:fragment slot="before-confirmation">
			<StorageModeSelector bind:mode={storageMode} />
			<SharedListSelector bind:value={selectedMnemonic} />
			<PasskeyOnboarding bind:mode={identityMode} bind:label={passkeyLabel} />
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
					A local-first peer-to-peer PWA · {formatVersions({
						appName: 'Simple-Todo'
					})} · {typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'local'} [{typeof __BUILD_DATE__ !==
					'undefined'
						? __BUILD_DATE__
						: 'dev'}]
				</p>
			</div>
		</div>
		<div class="flex flex-shrink-0 items-center gap-2 self-start sm:self-auto">
			<DidBadge did={$ownDidStore ?? ''} />
			<DelegatedAuthBadge />
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
					activeList={$activeListStore}
					on:change={() => {
						selectedMnemonic = activeMnemonic;
						showModal = true;
					}}
				/>
			{/if}
		</svelte:fragment>
	</P2PStatusNav>

	{#if !showModal && (error || $initializationStore.error)}
		<ErrorAlert error={error || $initializationStore.error} dismissible={true} />
	{/if}

	{#if $initializationStore.isInitialized}
		<NewPrivateListButton />
		<ListSwitcher />
		<OpenDatabaseForm />
		<PermissionsPanel />
	{/if}

	<!-- Add TODO Form -->
	<AddTodoForm
		on:add={handleAddTodo}
		disabled={!$initializationStore.isInitialized}
		{delegationEnabled}
	/>

	<!-- TODO List -->
	<TodoList
		todos={$todosStore}
		currentIdentityId={$ownIdentityIdStore}
		{delegationEnabled}
		on:delete={handleDelete}
		on:toggleComplete={handleToggleComplete}
		on:updateText={handleUpdateText}
		on:delegate={handleDelegate}
		on:revokeDelegation={handleRevokeDelegation}
	/>
</main>

<!-- Floating Relay Button FAB -->
{#if SponsorRelayFab}
	<svelte:component
		this={SponsorRelayFab}
		manifestUrl="./rootfs-manifest.json"
		showInstances={true}
	/>
{/if}
