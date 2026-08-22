<script>
	import { _ } from '$lib/i18n/index.js';
	import { createEventDispatcher } from 'svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	// Imported where they are used, not at module scope: `p2p.js` carries
	// libp2p/Helia/OrbitDB, and this form renders on the page — a static
	// import would put all of it back into the bundle the consent dialog
	// waits for. Both call sites are user actions.
	import { probeRelayAddresses } from './relay-probe.js';
	import {
		describeBootstrapMultiaddr,
		parseBootstrapMultiaddrs,
		selectValidBrowserBootstrapMultiaddrs
	} from './bootstrap-multiaddrs.js';

	export let disabled = false;
	export let compact = false;
	/**
	 * Discover relay addresses on mount.
	 *
	 * Off in this chapter. Discovery used to run automatically, fetch live relay
	 * registrations from the shared Aleph channel and *ping* them — and a ping is
	 * a dial. Making the libp2p config relay-free was therefore not enough: the
	 * app still came up holding three connections to a production relay, with
	 * circuit reservations, on a chapter whose entire claim is that two devices
	 * meet by nothing but a scanned code. Found by looking at the running app,
	 * not by reading the config.
	 *
	 * The button still discovers on demand, and milestone 3 turns this back on.
	 */
	export let autoDiscover = false;

	let selectedMultiaddr = '';
	let customMultiaddr = '';
	let useCustomMultiaddr = false;
	/** @type {string[]} */
	let discoveredMultiaddrs = [];
	let isDiscovering = true;
	let discoveredAddressCount = 0;
	let addressesPingVerified = false;
	/** @type {string | null} */
	let discoveryError = null;
	let isConnecting = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ tone: 'success' | 'warning' | 'info', title: string, detail: string } | null} */
	let statusMessage = null;
	let hasStartedInitialDiscovery = false;

	const dispatch = createEventDispatcher();

	/** @typedef {{ status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string }} ManualConnectResult */

	$: if (!disabled && !hasStartedInitialDiscovery && autoDiscover) {
		hasStartedInitialDiscovery = true;
		void refreshBootstrapMultiaddrs();
	}

	// Nothing has been discovered and nothing is being discovered — say so
	// instead of leaving the spinner up forever when auto-discovery is off.
	$: if (!autoDiscover && !hasStartedInitialDiscovery) isDiscovering = false;

	async function refreshBootstrapMultiaddrs() {
		isDiscovering = true;
		discoveryError = null;
		try {
			if (import.meta.env.VITE_ALEPH_BOOTSTRAP_DISCOVERY === 'false') {
				const configured =
					import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_DEV ||
					import.meta.env.VITE_RELAY_BOOTSTRAP_ADDR_PROD ||
					'';
				discoveredMultiaddrs = selectValidBrowserBootstrapMultiaddrs(
					parseBootstrapMultiaddrs(configured)
				);
				discoveredAddressCount = discoveredMultiaddrs.length;
				addressesPingVerified = false;
				selectedMultiaddr = discoveredMultiaddrs[0] ?? '';
				return;
			}

			const { discoverScopedBootstrapMultiaddrs } = await import('./aleph-bootstrap-discovery.js');
			// Scope discovery to our relay profile AND our production registration.
			// The Aleph channel is shared with other profiles (e.g.
			// universal-connectivity's `uc-go-peer`), and orphaned registrations
			// of erased E2E relays (`simple-todo-e2e-*`) otherwise flood the probe
			// wave with dead addresses (issue #84).
			const discovered = await discoverScopedBootstrapMultiaddrs({
				profile: import.meta.env.VITE_RELAY_BOOTSTRAP_PROFILE || 'orbitdb-relay',
				registrationId:
					import.meta.env.VITE_RELAY_BOOTSTRAP_REGISTRATION_ID ||
					'relay:orbitdb-relay:orbitdb-relay'
			});
			const candidates = selectValidBrowserBootstrapMultiaddrs(discovered);
			discoveredAddressCount = candidates.length;
			// Grouped by peer, not flat. Several of these addresses belong to the
			// same relay — `…libp2p.direct` and `…2n6.me`, each as dns4 and dns6 — and
			// libp2p muxes them onto one connection, where the ping service permits a
			// single outbound stream. Probing them together made the second ping fail
			// with TooManyOutboundProtocolStreamsError and the address was written off
			// as unreachable; on passkey01 that discarded every address of the only
			// live relay, leaving both browsers with nothing to dial (run 31717535131).
			discoveredMultiaddrs = await probeRelayAddresses(candidates, {
				ping: async (/** @type {any} */ addr) => {
					const { pingMultiaddr } = await import('./p2p.js');
					return pingMultiaddr(addr);
				},
				onUnreachable: (address, error) =>
					console.warn(`Ignoring unreachable Aleph relay address ${address}:`, error)
			});
			addressesPingVerified = true;
			if (
				discoveredMultiaddrs.length > 0 &&
				(!selectedMultiaddr || !discoveredMultiaddrs.includes(selectedMultiaddr))
			) {
				selectedMultiaddr = discoveredMultiaddrs[0];
			}
		} catch (error) {
			discoveredMultiaddrs = [];
			discoveredAddressCount = 0;
			addressesPingVerified = false;
			discoveryError = error instanceof Error ? error.message : String(error);
		} finally {
			isDiscovering = false;
		}
	}

	async function handleConnect() {
		const address = (useCustomMultiaddr ? customMultiaddr : selectedMultiaddr).trim();

		if (!address) {
			errorMessage = $_('tech.enterMultiaddr');
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
			title: $_('tech.dialing'),
			detail: $_('tech.handshake')
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
							title: $_('tech.connectionStable'),
							detail: result.detail
						}
					: {
							tone: 'warning',
							title: $_('tech.connectionDropped'),
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
	class:bg-surface={!compact}
	class:p-6={!compact}
	class:shadow-md={!compact}
>
	<div class:mb-4={!compact} class:mb-2={compact} class="flex items-start justify-between gap-4">
		<div>
			<h2 class:text-xl={!compact} class:text-sm={compact} class="font-semibold">
				{$_('net.connectToRelay')}
			</h2>
			<p class="mt-1 text-xs text-faint">{$_('net.relayHint')}</p>
		</div>
	</div>

	<div class:space-y-4={!compact} class:space-y-2={compact}>
		<div class="flex gap-2">
			<select
				data-testid="reachable-relay-select"
				bind:value={selectedMultiaddr}
				disabled={disabled || isConnecting || isDiscovering || discoveredMultiaddrs.length === 0}
				class="min-w-0 flex-1 rounded-md border border-border px-2 py-1.5 text-xs focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
			>
				{#if isDiscovering}
					<option value="">{$_('net.discovering')}</option>
				{:else if discoveredMultiaddrs.length === 0}
					<option value="">{$_('net.noRelayAddresses')}</option>
				{:else}
					{#each discoveredMultiaddrs as address (address)}
						<option value={address} data-ping-verified={addressesPingVerified ? 'true' : undefined}
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
				{isDiscovering ? $_('net.loading') : $_('net.refresh')}
			</button>
		</div>

		<label class="flex items-center gap-2 text-xs text-text">
			<input
				type="checkbox"
				bind:checked={useCustomMultiaddr}
				disabled={disabled || isConnecting}
			/>
			{$_('net.customMultiaddr')}
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
				error={$_('net.discoveryFailed', { values: { reason: discoveryError } })}
				type="warning"
				title={$_('net.discoveryUnavailable')}
				{compact}
			/>
		{:else if !isDiscovering && discoveredMultiaddrs.length === 0}
			<p class="text-sm text-data-700">
				{discoveredAddressCount > 0
					? $_('net.nonePinged', { values: { count: discoveredAddressCount } })
					: $_('net.noDialable')}
				{$_('net.refreshOrCustom')}
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
				{isConnecting ? $_('net.connecting') : $_('net.connect')}
			</button>
		</div>
	</div>
</div>
