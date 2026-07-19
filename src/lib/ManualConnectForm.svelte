<script>
	import { createEventDispatcher } from 'svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	import { connectToMultiaddr, pingMultiaddr } from './p2p.js';
	import {
		describeBootstrapMultiaddr,
		parseBootstrapMultiaddrs,
		selectValidBrowserBootstrapMultiaddrs
	} from './bootstrap-multiaddrs.js';

	export let disabled = false;
	export let compact = false;

	let selectedMultiaddr = '';
	let customMultiaddr = '';
	let useCustomMultiaddr = false;
	/** @type {string[]} */
	let discoveredMultiaddrs = [];
	let isDiscovering = false;
	let discoveredAddressCount = 0;
	/** Addresses that answered a live libp2p ping during a manual refresh. @type {Set<string>} */
	let pingVerifiedAddresses = new Set();
	/** @type {string | null} */
	let discoveryError = null;
	let isConnecting = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ tone: 'success' | 'warning' | 'info', title: string, detail: string } | null} */
	let statusMessage = null;
	let hasLoadedSnapshot = false;

	// Ping candidates in small batches so reachable relays appear in the
	// dropdown progressively instead of blocking until all ~50 finish (#38).
	const DISCOVERY_PING_BATCH_SIZE = 5;

	const dispatch = createEventDispatcher();

	/** @typedef {{ status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string }} ManualConnectResult */

	// #38: no automatic Aleph discovery on page load. The dropdown starts with
	// the pre-validated build-time snapshot so the page is immediately usable;
	// the Refresh button triggers live discovery in the background.
	$: if (!disabled && !hasLoadedSnapshot) {
		hasLoadedSnapshot = true;
		loadBuildTimeSnapshot();
	}

	function loadBuildTimeSnapshot() {
		const configured =
			import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV ||
			import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD ||
			'';
		discoveredMultiaddrs = selectValidBrowserBootstrapMultiaddrs(
			parseBootstrapMultiaddrs(configured)
		);
		discoveredAddressCount = discoveredMultiaddrs.length;
		pingVerifiedAddresses = new Set();
		selectedMultiaddr = discoveredMultiaddrs[0] ?? '';
	}

	async function refreshBootstrapMultiaddrs() {
		isDiscovering = true;
		discoveryError = null;
		try {
			if (import.meta.env.VITE_ALEPH_BOOTSTRAP_DISCOVERY === 'false') {
				loadBuildTimeSnapshot();
				return;
			}

			const { discoverAlephBootstrapMultiaddrs } = await import('@le-space/aleph-bootstrap');
			const discovered = await discoverAlephBootstrapMultiaddrs({
				browserDialableOnly: true,
				// Relay guests refresh every six hours. One day tolerates a missed refresh
				// without keeping dead temporary registrations visible for a week.
				maxAgeMs: 24 * 60 * 60 * 1000
			});
			const candidates = selectValidBrowserBootstrapMultiaddrs(discovered);
			discoveredAddressCount = candidates.length;
			/** @type {string[]} */
			const reachable = [];
			for (let index = 0; index < candidates.length; index += DISCOVERY_PING_BATCH_SIZE) {
				const batch = candidates.slice(index, index + DISCOVERY_PING_BATCH_SIZE);
				const results = await Promise.all(
					batch.map(async (address) => {
						try {
							await pingMultiaddr(address);
							return address;
						} catch (error) {
							console.warn(`Ignoring unreachable Aleph relay address ${address}:`, error);
							return null;
						}
					})
				);
				for (const address of results) {
					if (address == null) continue;
					reachable.push(address);
					pingVerifiedAddresses = new Set([...pingVerifiedAddresses, address]);
					// Progressive insertion: show each reachable relay as soon as it
					// answers, without waiting for the remaining candidates.
					if (!discoveredMultiaddrs.includes(address)) {
						discoveredMultiaddrs = [...discoveredMultiaddrs, address];
					}
				}
			}
			if (reachable.length > 0) {
				// Once the pass is complete, keep only live-verified relays so stale
				// snapshot entries do not linger; otherwise keep the snapshot usable.
				discoveredMultiaddrs = reachable;
				pingVerifiedAddresses = new Set(reachable);
				if (!selectedMultiaddr || !discoveredMultiaddrs.includes(selectedMultiaddr)) {
					selectedMultiaddr = discoveredMultiaddrs[0];
				}
			}
		} catch (error) {
			discoveryError = error instanceof Error ? error.message : String(error);
		} finally {
			isDiscovering = false;
		}
	}

	async function handleConnect() {
		const address = (useCustomMultiaddr ? customMultiaddr : selectedMultiaddr).trim();

		if (!address) {
			errorMessage = 'Enter a multiaddress to connect to a peer.';
			statusMessage = null;
			return;
		}

		if (!address.startsWith('/')) {
			errorMessage = 'A multiaddress must start with "/".';
			statusMessage = null;
			return;
		}

		errorMessage = null;
		statusMessage = {
			tone: 'info',
			title: 'Dialing peer',
			detail: 'Opening the websocket and completing the libp2p handshake...'
		};
		isConnecting = true;

		try {
			/** @type {ManualConnectResult} */
			const result = await connectToMultiaddr(address);
			statusMessage =
				result.status === 'stable'
					? {
							tone: 'success',
							title: 'Connection stable',
							detail: result.detail
						}
					: {
							tone: 'warning',
							title: 'Connection dropped',
							detail: result.detail
						};
			dispatch('connected', result);
			if (result.status === 'stable') {
				customMultiaddr = '';
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			statusMessage = null;
		} finally {
			isConnecting = false;
		}
	}

	/**
	 * @param {KeyboardEvent} event
	 */
	function handleKeydown(event) {
		if (event.key === 'Enter') {
			handleConnect();
		}
	}
</script>

<div
	class:rounded-lg={!compact}
	class:bg-white={!compact}
	class:p-6={!compact}
	class:shadow-md={!compact}
>
	<div class:mb-4={!compact} class:mb-2={compact} class="flex items-start justify-between gap-4">
		<div>
			<h2 class:text-xl={!compact} class:text-sm={compact} class="font-semibold">
				Connect to relay
			</h2>
			<p class="mt-1 text-xs text-gray-500">
				Choose a current browser-reachable relay discovered through Aleph.
			</p>
		</div>
	</div>

	<div class:space-y-4={!compact} class:space-y-2={compact}>
		<div class="flex gap-2">
			<select
				data-testid="reachable-relay-select"
				bind:value={selectedMultiaddr}
				disabled={disabled || isConnecting || discoveredMultiaddrs.length === 0}
				class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
			>
				{#if discoveredMultiaddrs.length === 0}
					<option value=""
						>{isDiscovering
							? 'Discovering and pinging Aleph relays…'
							: 'No relay addresses discovered'}</option
					>
				{:else}
					{#each discoveredMultiaddrs as address}
						<option
							value={address}
							data-ping-verified={pingVerifiedAddresses.has(address) ? 'true' : undefined}
							data-prevalidated={pingVerifiedAddresses.has(address) ? undefined : 'true'}
							>{describeBootstrapMultiaddr(address)}</option
						>
					{/each}
				{/if}
			</select>
			<button
				type="button"
				on:click={refreshBootstrapMultiaddrs}
				disabled={disabled || isConnecting || isDiscovering}
				class="rounded-md border border-gray-300 px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100"
			>
				{isDiscovering ? 'Loading…' : 'Refresh'}
			</button>
		</div>

		<label class="flex items-center gap-2 text-xs text-gray-600">
			<input
				type="checkbox"
				bind:checked={useCustomMultiaddr}
				disabled={disabled || isConnecting}
			/>
			Use a custom multiaddress
		</label>

		{#if useCustomMultiaddr}
			<input
				type="text"
				bind:value={customMultiaddr}
				placeholder="/dns4/example.com/tcp/443/wss/p2p/12D3KooW..."
				disabled={disabled || isConnecting}
				class="w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
				on:keydown={handleKeydown}
			/>
		{/if}

		{#if discoveryError}
			<ErrorAlert
				error={`Aleph relay discovery failed: ${discoveryError}`}
				type="warning"
				title="Relay discovery unavailable"
				{compact}
			/>
		{:else if !isDiscovering && discoveredMultiaddrs.length === 0}
			<p class="text-sm text-amber-700">
				{discoveredAddressCount > 0
					? `None of the ${discoveredAddressCount} discovered relay addresses answered a libp2p ping.`
					: 'No relays in the build-time snapshot.'}
				Refresh or enter a custom multiaddress.
			</p>
		{/if}

		{#if errorMessage}
			<ErrorAlert error={errorMessage} {compact} />
		{/if}

		{#if statusMessage}
			<ErrorAlert
				error={statusMessage.detail}
				type={statusMessage.tone === 'success'
					? 'info'
					: statusMessage.tone === 'warning'
						? 'warning'
						: 'info'}
				title={statusMessage.title}
				{compact}
			/>
		{/if}

		<div class="flex gap-2">
			<button
				on:click={handleConnect}
				disabled={disabled ||
					isConnecting ||
					!(useCustomMultiaddr ? customMultiaddr.trim() : selectedMultiaddr)}
				class="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-gray-400"
			>
				{isConnecting ? 'Connecting...' : 'Connect'}
			</button>
		</div>
	</div>
</div>
