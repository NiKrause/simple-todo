<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { getRelayBootstrapAddrs } from '$lib/relay-bootstrap-addrs.js';
	import { peerIdStore, initializationStore } from '$lib/p2p-stores.js';
	import { getRelayNetworkEnabled, setRelayNetworkEnabled } from '$lib/network-mode.js';
	import {
		getPersistentStorageEnabled,
		setPersistentStorageEnabled,
		wipePersistentStorage
	} from '$lib/storage-mode.js';
	import { formatBuildDate, formatVersions } from '$lib/build-info.js';
	import { todosStore, addTodo, deleteTodo, toggleTodoComplete } from '$lib/db-actions.js';
	import ConsentModal from '$lib/ConsentModal.svelte';
	import SocialIcons from '$lib/SocialIcons.svelte';
	import ThemeToggle from '$lib/ThemeToggle.svelte';
	import LeSpaceLogo from '$lib/LeSpaceLogo.svelte';
	import ToastNotification from '$lib/ToastNotification.svelte';
	import P2PStatusNav from '$lib/P2PStatusNav.svelte';
	import ErrorAlert from '$lib/ErrorAlert.svelte';
	import AddTodoForm from '$lib/AddTodoForm.svelte';
	import TodoList from '$lib/TodoList.svelte';
	import QrConnect from '$lib/QrConnect.svelte';
	import ConnectedPeers from '$lib/ConnectedPeers.svelte';
	import PeerIdCard from '$lib/PeerIdCard.svelte';
	import OwnMultiaddrs from '$lib/OwnMultiaddrs.svelte';
	import ManualConnectForm from '$lib/ManualConnectForm.svelte';
	import { libp2pStore } from '$lib/p2p-stores.js';
	import SponsorRelayFab from '@le-space/ui/svelte';

	/** @typedef {'default' | 'success' | 'error' | 'warning'} ToastType */
	/** @typedef {{ detail: { text: string } }} AddTodoEvent */
	/** @typedef {{ detail: { key: string } }} TodoActionEvent */

	const CONSENT_KEY = `consentAccepted@${typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}`;

	/** @type {string | null} */
	let toastMessage = null;
	/** @type {ToastType} */
	let toastType = 'default';
	/** @type {string | null} */
	let error = null;
	/** @type {string | null} */
	let myPeerId = null;

	// Modal state
	let showModal = true;
	let rememberDecision = false;
	// Seeded from storage so the box reflects this browser's existing choice
	// rather than resetting to the default on every visit.
	let relayNetworkEnabled = getRelayNetworkEnabled();
	// Same reason as above: seeded from storage so the switch reflects this
	// browser's existing choice rather than resetting to the default on every visit.
	let persistentStorageEnabled = getPersistentStorageEnabled();

	const handleModalClose = async () => {
		showModal = false;
		// Written before initializeP2P: createLibp2pConfig reads the choice while
		// building the node, so persisting it afterwards would start the wrong one.
		setRelayNetworkEnabled(relayNetworkEnabled);
		// Also before initializeP2P: this one decides which stores Helia and OrbitDB
		// are built with, and those cannot be swapped after the node exists.
		// Turning it off has to delete what being on wrote, or the label is a lie
		// for anyone who used the switch in that order. Before persisting the new
		// value, so a wipe that fails leaves the old choice intact rather than
		// claiming a clean slate it did not achieve.
		if (!persistentStorageEnabled && getPersistentStorageEnabled()) {
			const { deleted } = await wipePersistentStorage();
			console.info('Cleared persistent storage on switching to in-memory:', deleted);
			try {
				// The author id belongs to the same promise; a stale one would outlive
				// the data it signed.
				localStorage.removeItem('simpleTodo.orbitdbIdentityId');
			} catch {
				// ignore storage errors
			}
		}
		setPersistentStorageEnabled(persistentStorageEnabled);
		try {
			if (rememberDecision) {
				localStorage.setItem(CONSENT_KEY, 'true');
			}
		} catch {
			// ignore storage errors
		}
		try {
			await startP2P();
		} catch (err) {
			error = `Failed to initialize P2P: ${err instanceof Error ? err.message : String(err)}`;
			console.error('P2P initialization failed:', err);
		}
	};

	// Loaded on demand, not at page load. `p2p.js` pulls libp2p, Helia, OrbitDB
	// and gossipsub — 1.6 MB — and none of it is needed to show the consent
	// dialog, which is the only thing on screen until the user agrees. Keeping
	// it in the eager bundle meant the page stayed blank until all of it had
	// arrived: measured at 2562 KB before the dialog could render.
	async function startP2P() {
		const { initializeP2P } = await import('$lib/p2p.js');
		await initializeP2P();
		void recoverRelayIfBakedOnesAreGone();
	}

	// The baked relay was alive when this build was made. It may not be now.
	//
	// `resolve-aleph-bootstrap.mjs` discovers and *probes* the relays at deploy
	// time, so what ships is verified — but a relay VM lives about a day, and a
	// snapshot cannot survive that. On 2026-08-22 the deployed app spent two
	// minutes on `ERR_CONNECTION_CLOSED` with no dialable address, while two
	// healthy relays were registered on the Aleph channel the whole time.
	//
	// So: baked first, and only when none of them answer, ask the directory.
	// The grace period is what keeps this off the fast path — a normal start
	// connects long before it elapses and the check then costs one predicate.
	const RELAY_RECOVERY_GRACE_MS = 20_000;
	async function recoverRelayIfBakedOnesAreGone() {
		await new Promise((resolve) => setTimeout(resolve, RELAY_RECOVERY_GRACE_MS));
		try {
			const [{ recoverRelayConnection }, { probeRelayAddresses }, p2p] = await Promise.all([
				import('$lib/relay-fallback.js'),
				import('$lib/relay-probe.js'),
				import('$lib/p2p.js')
			]);
			await recoverRelayConnection({
				// "Do we have any relay at all", not "a public one". The e2e suite
				// runs its relay on 127.0.0.1, and treating that as absent made this
				// fall back mid-test — reaching for the real Aleph directory and
				// dialling a public relay while a local one was working fine.
				// Comparing against the baked peer ids says exactly what is meant.
				isConnected: () => {
					const node = get(libp2pStore);
					const baked = new Set(
						getRelayBootstrapAddrs()
							.map((address) => address.match(/\/p2p\/([^/]+)$/)?.[1])
							.filter(Boolean)
					);
					return (node?.getConnections?.() ?? []).some((/** @type {any} */ connection) =>
						baked.has(String(connection?.remotePeer ?? ''))
					);
				},
				discover: async () => {
					// Imported here, not above: a start that never needs the fallback
					// must not load the Aleph client at all.
					const { discoverScopedBootstrapMultiaddrs } = await import(
						'$lib/aleph-bootstrap-discovery.js'
					);
					return discoverScopedBootstrapMultiaddrs();
				},
				probe: (candidates) => probeRelayAddresses(candidates, { ping: p2p.pingMultiaddr }),
				connect: (address) => p2p.connectToMultiaddr(address),
				log: (message, detail) => console.info(`[relay-fallback] ${message}`, detail ?? '')
			});
		} catch (err) {
			console.warn('[relay-fallback] could not run:', err);
		}
	}

	onMount(async () => {
		try {
			if (localStorage.getItem(CONSENT_KEY) === 'true') {
				showModal = false;
				await startP2P();
			}
		} catch {
			// ignore storage errors
		}
	});

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
		const success = await addTodo(event.detail.text);
		if (success) {
			showToast('✅ Todo added successfully!', 'success');
		} else {
			showToast('❌ Failed to add todo', 'error');
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
		title="Simple-Todo"
		bind:persistentStorageEnabled
		bind:relayNetworkEnabled
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
		<div class="flex flex-1 items-center gap-3">
			<LeSpaceLogo size={52} />
			<div>
				<h1 class="text-2xl font-bold text-heading sm:text-3xl">Simple-Todo</h1>
				<p class="mt-1 text-sm text-faint">
					A local-first peer-to-peer PWA · {formatVersions({
						appName: 'Simple-Todo'
					})} · {typeof __APP_BRANCH__ !== 'undefined' ? __APP_BRANCH__ : 'local'} [{formatBuildDate(
						typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''
					)}]
				</p>
			</div>
		</div>
		<div class="flex flex-shrink-0 items-center gap-2 self-start sm:self-auto">
			<ThemeToggle />
			<SocialIcons size="w-5 h-5" className="" />
		</div>
	</header>

	<P2PStatusNav initialization={$initializationStore} libp2p={$libp2pStore} peerId={myPeerId}>
		<!--
			Both ways of meeting a peer now live next to the Connect button that
			opens a relay by hand, instead of floating over the app: this column is
			where someone already goes to ask "how do I reach anybody", and a
			launcher pinned to the viewport corner answered that question somewhere
			the question was never asked.
		-->
		<div class="space-y-3">
			<ManualConnectForm
				compact
				disabled={!$initializationStore.isInitialized}
				on:connected={handleManualConnect}
			/>
			<div class="flex flex-wrap items-center gap-2 border-t border-border pt-3">
				<SponsorRelayFab
					manifestUrl="./rootfs-manifest.json"
					showInstances={true}
					launcherMode="inline"
				/>
				<QrConnect />
			</div>
		</div>
		<ConnectedPeers compact bind:this={connectedPeersRef} libp2p={$libp2pStore} />
		<div class="space-y-3">
			<PeerIdCard compact peerId={myPeerId} />
			<OwnMultiaddrs libp2p={$libp2pStore} />
		</div>
	</P2PStatusNav>

	{#if error || $initializationStore.error}
		<ErrorAlert error={error || $initializationStore.error} dismissible={true} />
	{/if}

	<!-- Add TODO Form -->
	<AddTodoForm on:add={handleAddTodo} disabled={!$initializationStore.isInitialized} />

	<!-- TODO List -->
	<TodoList todos={$todosStore} on:delete={handleDelete} on:toggleComplete={handleToggleComplete} />
</main>
