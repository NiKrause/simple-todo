<script>
	import { onMount } from 'svelte';
	import { _, locale } from '$lib/i18n/index.js';
	import { peerIdStore, initializationStore, ownDidStore } from '$lib/p2p-stores.js';
	import PasskeyOnboarding from '$lib/PasskeyOnboarding.svelte';
	import OnePasskeyIntro from '$lib/OnePasskeyIntro.svelte';
	import LanguageSwitcher from '$lib/LanguageSwitcher.svelte';
	import DidBadge from '$lib/DidBadge.svelte';
	import AuditorView from '$lib/AuditorView.svelte';
	import BalanceCard from '$lib/BalanceCard.svelte';
	import BudgetNotices from '$lib/BudgetNotices.svelte';
	import TechnicalExplanation from '$lib/TechnicalExplanation.svelte';
	import TechnicalToggle from '$lib/TechnicalToggle.svelte';
	import { technicalView } from '$lib/technical-view.js';
	import { formatAmount } from '$lib/budget.js';
	import {
		addTodoWithBudget,
		budgetInfo,
		readAmount,
		refreshBalance,
		releaseTodoBudget,
		watchPayouts
	} from '$lib/budget-store.js';
	import { shortId } from '$lib/utils.js';
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
	import SectionTabs from '$lib/SectionTabs.svelte';
	import NetworkStatusDot from '$lib/NetworkStatusDot.svelte';
	import ActiveListHeading from '$lib/ActiveListHeading.svelte';
	import { AUDITOR_SECTION, currentSection } from '$lib/sections.js';
	import {
		RELAY_FAB_POSITION_KEY,
		placeRelayButtonForThisScreen
	} from '$lib/relay-fab-position.js';

	/** @typedef {'default' | 'success' | 'error' | 'warning'} ToastType */
	/** @typedef {{ detail: { text: string, delegateDid?: string | null, delegationExpiresAt?: string | null, budgetAmount?: bigint | null } }} AddTodoEvent */
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
		const component = (await import('@le-space/ui/svelte')).default;
		// Read once, when the launcher mounts: on a phone it starts above the tab
		// bar rather than on top of it.
		placeRelayButtonForThisScreen();
		SponsorRelayFab = component;
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
		const { text, delegateDid, delegationExpiresAt, budgetAmount } = event.detail;
		// escrow01: with a budget, the todo is written "being locked" and the lock
		// follows; how it went shows on the row and in the notices, not here.
		const result =
			delegateDid && budgetAmount
				? await addTodoWithBudget({
						text,
						delegateDid,
						expiresAt: delegationExpiresAt ?? null,
						amount: budgetAmount
					})
				: await addTodo(text, null, {
						delegateDid: delegateDid ?? null,
						expiresAt: delegationExpiresAt ?? null
					});
		if (result.ok) {
			showToast(delegateDid ? $_('todo.toast.addedDelegated') : $_('todo.toast.added'), 'success');
		} else {
			showToast(`❌ ${result.error ?? $_('todo.toast.addFailed')}`, 'error');
		}
	};

	/** @param {TodoActionEvent} event */
	const handleReleaseBudget = async (event) => {
		await releaseTodoBudget(event.detail.key);
	};

	/**
	 * A budget paid out to this session while it was watching (escrow01).
	 *
	 * @param {import('$lib/db-actions.js').TodoItem} todo
	 */
	async function announcePayout(todo) {
		const from = shortId(todo.createdByIdentity ?? '');
		const todoRef = todo.budget?.todoRef;
		const amount =
			todoRef && todo.createdByIdentity ? await readAmount(todo.createdByIdentity, todoRef) : null;
		showToast(
			amount?.state === 'ready' && amount.units !== null
				? $_('budget.toast.received', {
						values: {
							amount: formatAmount(amount.units, {
								decimals: budgetInfo.token.decimals,
								locale: $locale ?? 'en'
							}),
							token: budgetInfo.token.symbol,
							from
						}
					})
				: $_('budget.toast.receivedHidden', { values: { from } }),
			'success',
			6000
		);
		void refreshBalance();
	}

	onMount(() => watchPayouts((todo) => void announcePayout(todo)));

	/*
		escrow01's sections: the todos first, the lists, the account and the
		network behind tabs, and the auditor view without a tab of its own. Like
		the auditor view before them, sections of this page rather than routes:
		this page owns the consent dialog and the P2P start, and a navigation away
		and back would mount it again and start both over. The fragment says which
		one is open, so `#pruefstelle` still opens the page on the auditor view.
	*/
	$: auditorOpen = $currentSection === AUDITOR_SECTION;

	// A section opens at its top. Otherwise it opens wherever the last one was
	// scrolled to, which on a phone is often below everything the new one holds.
	onMount(() => {
		let first = true;
		return currentSection.subscribe(() => {
			if (!first) window.scrollTo({ top: 0 });
			first = false;
		});
	});

	// What this build is made of — versions, branch, build date — in the
	// technical view, as on the consent screen.
	const buildStamp = `${formatVersions({ appName: 'Simple-Todo' })} · ${
		typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'local'
	} [${typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]`;

	// A budget is paid to the delegate, so it exists only where delegation does,
	// and only for a session the service can sign for.
	$: budgetEnabled = delegationEnabled && (!budgetInfo.requiresPasskey || Boolean($ownDidStore));
	$: budgetsInList = $todosStore.some((todo) => todo.budget && todo.budget.status !== 'none');
	// The balance appears where the storyboard has it: once a budget was paid
	// out to this session.
	$: showBalance =
		Boolean($ownIdentityIdStore) &&
		$todosStore.some(
			(todo) =>
				todo.budget?.status === 'released' && todo.delegation?.delegateDid === $ownIdentityIdStore
		);

	/**
	 * @param {TodoActionEvent} event
	 */
	const handleDelete = async (event) => {
		const success = await deleteTodo(event.detail.key);
		if (success) {
			showToast($_('todo.toast.deleted'), 'success');
		} else {
			showToast($_('todo.toast.deleteFailed'), 'error');
		}
	};

	/**
	 * @param {TodoActionEvent} event
	 */
	const handleToggleComplete = async (event) => {
		const result = await toggleTodoComplete(event.detail.key);
		if (result.ok) {
			showToast($_('todo.toast.statusUpdated'), 'success');
		} else {
			showToast(`❌ ${result.error ?? $_('todo.toast.updateFailed')}`, 'error');
		}
	};

	/** @param {UpdateTextEvent} event */
	const handleUpdateText = async (event) => {
		const result = await updateTodoText(event.detail.key, event.detail.text);
		showToast(
			result.ok ? $_('todo.toast.renamed') : `❌ ${result.error ?? $_('todo.toast.renameFailed')}`,
			result.ok ? 'success' : 'error'
		);
	};

	/** @param {DelegateEvent} event */
	const handleDelegate = async (event) => {
		const { key, delegateDid, expiresAt } = event.detail;
		const result = await delegateTodo(key, { delegateDid, expiresAt });
		showToast(
			result.ok
				? $_('todo.toast.delegated')
				: `❌ ${result.error ?? $_('todo.toast.delegateFailed')}`,
			result.ok ? 'success' : 'error'
		);
	};

	/** @param {TodoActionEvent} event */
	const handleRevokeDelegation = async (event) => {
		const result = await revokeTodoDelegation(event.detail.key);
		showToast(
			result.ok ? $_('todo.toast.revoked') : `❌ ${result.error ?? $_('todo.toast.revokeFailed')}`,
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
			showToast($_('network.connect.toastConnected', { values: { peer: peerTarget } }), 'success');
			return;
		}

		showToast($_('network.connect.toastDropped', { values: { peer: peerTarget } }), 'warning');
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
			<OnePasskeyIntro confidential={budgetInfo.confidential} storage={storageMode} />
			<StorageModeSelector bind:mode={storageMode} />
			<SharedListSelector bind:value={selectedMnemonic} />
			<PasskeyOnboarding bind:mode={identityMode} bind:label={passkeyLabel} />
		</svelte:fragment>
	</ConsentModal>
{/if}

<main class="container mx-auto max-w-4xl px-4 pt-4 pb-28 sm:px-6 sm:pt-6 sm:pb-6">
	<!--
		What stays on screen on every tab: the app, the network's state as a dot
		(a link to the network tab), the language and the technical view — the
		switches somebody presenting reaches for while they talk.

		A grid, so a phone gets two short rows instead of three wrapped ones: the
		title and the switches on the first, the state on the second. From `sm` on,
		all three share one row.
	-->
	<header
		class="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:mb-6 sm:grid-cols-[minmax(0,1fr)_auto_auto]"
	>
		<div class="col-start-1 row-start-1 flex min-w-0 items-center gap-3">
			<LeSpaceLogo size={44} />
			<div class="min-w-0">
				{#if auditorOpen}
					<h1 class="truncate text-xl font-bold text-heading sm:text-3xl">
						{$_('budget.auditor.title')}
					</h1>
					<p class="mt-1 text-sm text-faint">
						{$_('budget.auditor.escrow')}
						<code class="font-mono text-xs" title={budgetInfo.escrow}
							>{shortId(budgetInfo.escrow)}</code
						>
					</p>
				{:else}
					<h1 class="truncate text-xl font-bold text-heading sm:text-3xl">Simple-Todo</h1>
					<!-- On a phone the list's name is the better use of the line. -->
					<p class="mt-0.5 hidden text-sm text-faint sm:block" data-testid="app-tagline">
						{$_('header.tagline')}
					</p>
				{/if}
			</div>
		</div>
		<div
			class="col-span-2 row-start-2 flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:justify-end"
		>
			<DelegatedAuthBadge />
			{#if auditorOpen}
				<DidBadge did={budgetInfo.auditor} label={$_('budget.auditor.role')} />
				<a
					href="#aufgaben"
					data-testid="auditor-view-close"
					class="rounded-md px-2 py-1 text-xs font-medium text-cyan-800 no-underline hover:underline dark:text-cyan"
					>{$_('header.backToTodos')}</a
				>
			{/if}
			<NetworkStatusDot />
		</div>
		<div class="col-start-2 row-start-1 flex items-center gap-1 sm:col-start-3 sm:gap-2">
			<LanguageSwitcher />
			<TechnicalToggle />
		</div>
	</header>

	<SectionTabs />

	{#if !showModal && (error || $initializationStore.error)}
		<!-- `error` is already a sentence; the store holds the stack's bare reason. -->
		<ErrorAlert
			error={error ||
				$_('consent.errorStart', { values: { reason: $initializationStore.error ?? '' } })}
			dismissible={true}
		/>
	{/if}

	{#if auditorOpen}
		<AuditorView />
	{/if}

	<!--
		Every section stays mounted and is only hidden: the network panel and the
		forms hold state that a remount would throw away, and the status panel
		publishes what the header's dot and every todo row's replication proof read.
	-->
	<section
		hidden={$currentSection !== 'aufgaben'}
		aria-label={$_('sections.tab.tasks')}
		data-testid="section-aufgaben"
	>
		{#if $initializationStore.isInitialized}
			<ActiveListHeading mnemonic={activeMnemonic} />
		{/if}

		<AddTodoForm
			on:add={handleAddTodo}
			disabled={!$initializationStore.isInitialized}
			{delegationEnabled}
			{budgetEnabled}
			budgetToken={budgetInfo.token.symbol}
			budgetDecimals={budgetInfo.token.decimals}
			budgetConfidential={budgetInfo.confidential}
		/>

		<BudgetNotices active={budgetsInList || showBalance} />

		<TodoList
			todos={$todosStore}
			currentIdentityId={$ownIdentityIdStore}
			{delegationEnabled}
			on:delete={handleDelete}
			on:toggleComplete={handleToggleComplete}
			on:updateText={handleUpdateText}
			on:delegate={handleDelegate}
			on:revokeDelegation={handleRevokeDelegation}
			on:releaseBudget={handleReleaseBudget}
		/>
	</section>

	<section
		hidden={$currentSection !== 'listen'}
		aria-label={$_('sections.tab.lists')}
		data-testid="section-listen"
	>
		{#if $initializationStore.isInitialized}
			<!-- The open list first: its address, and who may write to it. -->
			{#if activeMnemonic}
				<SharedListDetails
					open
					mnemonic={activeMnemonic}
					databaseAddress={$todoDBAddressStore}
					activeList={$activeListStore}
					on:change={() => {
						selectedMnemonic = activeMnemonic;
						showModal = true;
					}}
				/>
			{/if}
			<PermissionsPanel />
			<ListSwitcher />
			<NewPrivateListButton />
			<OpenDatabaseForm />
		{:else}
			<p class="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-text shadow-sm">
				{$_('sections.lists.waiting')}
			</p>
		{/if}
	</section>

	<section
		hidden={$currentSection !== 'konto'}
		aria-label={$_('sections.tab.account')}
		data-testid="section-konto"
	>
		<div
			class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
			data-testid="account-passkey"
		>
			<h2 class="text-sm font-medium text-faint">{$_('sections.account.passkey')}</h2>
			{#if $ownDidStore}
				<div class="mt-2 flex flex-wrap">
					<DidBadge did={$ownDidStore} />
				</div>
				<p class="mt-2 text-xs text-faint">{$_('sections.account.passkeyHint')}</p>
			{:else}
				<p class="mt-1 text-sm text-text">{$_('sections.account.noPasskey')}</p>
			{/if}
		</div>

		<!-- The balance appears where the storyboard has it: once a budget was paid
		     out to this session. -->
		{#if showBalance}
			<BalanceCard />
		{:else}
			<div
				class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
				data-testid="account-balance-waiting"
			>
				<h2 class="text-sm font-medium text-faint">{$_('budget.balance.heading')}</h2>
				<p class="mt-1 text-sm text-text">{$_('sections.account.balanceWaiting')}</p>
			</div>
		{/if}

		<div
			class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
			data-testid="account-chain"
		>
			<h2 class="text-sm font-medium text-faint">{$_('sections.account.chain')}</h2>
			<span
				class="mt-2 inline-block rounded-md border px-2 py-1 text-xs font-medium {budgetInfo.network ===
				'demo'
					? 'border-data-400 bg-data-100 text-data-800 dark:border-data/40 dark:bg-data/10 dark:text-data'
					: 'border-cyan-200 bg-cyan-50 text-cyan-800 dark:border-cyan/40 dark:bg-cyan/10 dark:text-cyan'}"
				data-testid="budget-network"
				data-network={budgetInfo.network}
				>{budgetInfo.network === 'demo'
					? $_('budget.network.demo')
					: $_('budget.network.sepolia')}</span
			>
			<!-- What "Demo ohne Chain" means, and the real run it stands in for. -->
			{#if budgetInfo.network === 'demo'}
				<p class="mt-2 text-sm text-text">{$_('budget.network.demoTitle')}</p>
				<TechnicalExplanation step="demo" collapsible className="mt-3" />
			{/if}
		</div>

		<div
			class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
			data-testid="account-auditor"
		>
			<h2 class="text-sm font-medium text-faint">{$_('sections.account.auditor')}</h2>
			<p class="mt-1 text-sm text-text">{$_('sections.account.auditorHint')}</p>
			<a
				href="#pruefstelle"
				data-testid="auditor-view-open"
				class="mt-3 inline-block rounded-md border border-cyan-200 px-3 py-1.5 text-sm font-medium text-cyan-800 no-underline hover:bg-cyan-50 dark:border-cyan/40 dark:text-cyan dark:hover:bg-cyan/10"
				>{$_('sections.account.auditorOpen')}</a
			>
		</div>
	</section>

	<section
		hidden={$currentSection !== 'netzwerk'}
		aria-label={$_('sections.tab.network')}
		data-testid="section-netzwerk"
	>
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
		</P2PStatusNav>

		<div
			class="mb-6 rounded-lg border border-border bg-surface px-6 py-4 shadow-sm"
			data-testid="app-settings"
		>
			<h2 class="text-sm font-medium text-faint">{$_('sections.network.app')}</h2>
			<dl class="mt-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 gap-y-2 text-sm">
				<dt class="text-text">{$_('sections.network.theme')}</dt>
				<dd><ThemeToggle /></dd>
				<dt class="text-text">{$_('sections.network.links')}</dt>
				<dd><SocialIcons size="w-5 h-5" className="-ml-2" /></dd>
				{#if $technicalView}
					<dt class="text-text">{$_('sections.network.version')}</dt>
					<dd>
						<code class="font-mono text-xs break-all text-text" data-testid="app-version"
							>{buildStamp}</code
						>
					</dd>
				{/if}
			</dl>
		</div>
	</section>
</main>

<!--
	Floating Relay Button FAB.

	Draggable, because it floats over the bottom-right corner, and on a phone
	the todo rows scroll underneath it. The key is passed explicitly: the
	component stores nothing unless asked, and the key keeps this chapter's
	`simpleTodo.` prefix. On a phone it starts above the tab bar
	(relay-fab-position.js).

	Shown in both views, as in the other chapters: the Relay Button belongs to
	the app, not to the plumbing the simple view leaves out. The widget has no
	way to take this page's language, so its label stays English.
-->
{#if SponsorRelayFab}
	<svelte:component
		this={SponsorRelayFab}
		manifestUrl="./rootfs-manifest.json"
		showInstances={true}
		draggable={true}
		positionStorageKey={RELAY_FAB_POSITION_KEY}
	/>
{/if}
