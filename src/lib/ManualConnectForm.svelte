<script>
	import { _ } from '$lib/i18n/index.js';
	import { createEventDispatcher } from 'svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	// Imported where it is used, not at module scope: `p2p.js` carries
	// libp2p/Helia/OrbitDB, and this form is rendered on the page — a static
	// import would put all of it back into the eager bundle that the consent
	// dialog waits for. Both call sites are user actions, so the cost lands
	// when somebody actually connects.
	import { probeRelayAddresses } from './relay-probe.js';
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

	/**
	 * `detail` is a message key: it comes from `p2p.js`, which cannot translate.
	 *
	 * @typedef {{ status: 'stable' | 'dropped', detail: string, detailValues?: any, remotePeer: string | null, remoteAddr: string }} ManualConnectResult
	 */

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

			const { discoverScopedBootstrapMultiaddrs } = await import('./aleph-bootstrap-discovery.js');
			const discovered = await discoverScopedBootstrapMultiaddrs({
				// Only surface relays of our own implementation. The Aleph channel is
				// shared with other relay profiles (e.g. universal-connectivity's
				// `uc-go-peer`) that an orbitdb browser cannot replicate through.
				profile: import.meta.env.VITE_RELAY_BOOTSTRAP_PROFILE || 'orbitdb-relay',
				// Scope to the production registration: ephemeral E2E relays register
				// as `simple-todo-e2e-*` and their orphaned records otherwise flood
				// the probe wave with dead addresses (issue #84).
				registrationId:
					import.meta.env.VITE_RELAY_BOOTSTRAP_REGISTRATION_ID ||
					'relay:orbitdb-relay:orbitdb-relay'
			});
			const candidates = selectValidBrowserBootstrapMultiaddrs(discovered);
			discoveredAddressCount = candidates.length;
			// Batched by peer, not by position. Several of these addresses belong to
			// the same relay — `…libp2p.direct` and `…2n6.me`, each as dns4 and dns6 —
			// and libp2p muxes them onto one connection, where the ping service
			// permits a single outbound stream. A positional batch could hold two of
			// them; the second ping then failed with
			// TooManyOutboundProtocolStreamsError and the address was written off as
			// unreachable. When that hit every address of the only live relay, the app
			// was left with nothing to dial (passkey01 run 31717535131).
			const reachable = await probeRelayAddresses(candidates, {
				ping: async (/** @type {any} */ addr) => {
					const { pingMultiaddr } = await import('./p2p.js');
					return pingMultiaddr(addr);
				},
				groupConcurrency: DISCOVERY_PING_BATCH_SIZE,
				onUnreachable: (address, error) =>
					console.warn(`Ignoring unreachable Aleph relay address ${address}:`, error),
				onReachable: (address) => {
					pingVerifiedAddresses = new Set([...pingVerifiedAddresses, address]);
					// Progressive insertion: show each reachable relay as soon as it
					// answers, without waiting for the remaining candidates.
					if (!discoveredMultiaddrs.includes(address)) {
						discoveredMultiaddrs = [...discoveredMultiaddrs, address];
					}
				}
			});
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
			errorMessage = $_('manual.customHint');
			statusMessage = null;
			return;
		}

		if (!address.startsWith('/')) {
			errorMessage = $_('manual.mustStartWithSlash');
			statusMessage = null;
			return;
		}

		errorMessage = null;
		statusMessage = {
			tone: 'info',
			title: $_('manual.dialing'),
			detail: $_('manual.handshake')
		};
		isConnecting = true;

		try {
			const { connectToMultiaddr } = await import('./p2p.js');
			/** @type {ManualConnectResult} */
			const result = await connectToMultiaddr(address);
			statusMessage =
				result.status === 'stable'
					? {
							tone: 'success',
							title: $_('manual.stable'),
							detail: $_(result.detail, { values: result.detailValues })
						}
					: {
							tone: 'warning',
							title: $_('manual.dropped'),
							detail: $_(result.detail, { values: result.detailValues })
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
	class:bg-surface={!compact}
	class:p-6={!compact}
	class:shadow-md={!compact}
>
	<div class:mb-4={!compact} class:mb-2={compact} class="flex items-start justify-between gap-4">
		<div>
			<h2 class:text-xl={!compact} class:text-sm={compact} class="font-semibold">
				{$_('manual.heading')}
			</h2>
			<p class="mt-1 text-xs text-faint">
				{$_('manual.discoveredHint')}
			</p>
		</div>
	</div>

	<div class:space-y-4={!compact} class:space-y-2={compact}>
		<div class="flex gap-2">
			<select
				data-testid="reachable-relay-select"
				bind:value={selectedMultiaddr}
				disabled={disabled || isConnecting || discoveredMultiaddrs.length === 0}
				class="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-xs focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
			>
				{#if discoveredMultiaddrs.length === 0}
					<option value=""
						>{isDiscovering ? $_('manual.discovering') : $_('manual.noneDiscovered')}</option
					>
				{:else}
					{#each discoveredMultiaddrs as address (address)}
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
				class="rounded-md border border-border px-2 py-1.5 text-xs font-medium text-text hover:bg-surface disabled:cursor-not-allowed disabled:bg-surface-2"
			>
				{isDiscovering ? 'Loading…' : 'Refresh'}
			</button>
		</div>

		<label class="flex items-center gap-2 text-xs text-text">
			<input
				type="checkbox"
				bind:checked={useCustomMultiaddr}
				disabled={disabled || isConnecting}
			/>
			{$_('manual.customToggle')}
		</label>

		{#if useCustomMultiaddr}
			<input
				type="text"
				bind:value={customMultiaddr}
				placeholder="/dns4/example.com/tcp/443/wss/p2p/12D3KooW..."
				disabled={disabled || isConnecting}
				class="w-full rounded-md border border-border px-2 py-1.5 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
				on:keydown={handleKeydown}
			/>
		{/if}

		{#if discoveryError}
			<ErrorAlert
				error={$_('manual.discoveryFailed', { values: { reason: discoveryError } })}
				type="warning"
				title={$_('manual.discoveryUnavailable')}
				{compact}
			/>
		{:else if !isDiscovering && discoveredMultiaddrs.length === 0}
			<p class="text-sm text-data-700">
				{discoveredAddressCount > 0
					? $_('manual.noneAnswered', { values: { count: discoveredAddressCount } })
					: $_('manual.noSnapshot')}
				{$_('manual.refreshHint')}
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
				class="rounded-md bg-code px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-code disabled:cursor-not-allowed disabled:bg-faint"
			>
				{isConnecting ? 'Connecting...' : 'Connect'}
			</button>
		</div>
	</div>
</div>
