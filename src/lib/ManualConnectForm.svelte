<script>
	import { createEventDispatcher } from 'svelte';
	import { onMount } from 'svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	import { connectToMultiaddr } from './p2p.js';
	import {
		describeBootstrapMultiaddr,
		selectValidBrowserBootstrapMultiaddrs
	} from './bootstrap-multiaddrs.js';

	export let disabled = false;
	export let compact = false;

	let selectedMultiaddr = '';
	let customMultiaddr = '';
	let useCustomMultiaddr = false;
	/** @type {string[]} */
	let discoveredMultiaddrs = [];
	let isDiscovering = true;
	/** @type {string | null} */
	let discoveryError = null;
	let isConnecting = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ tone: 'success' | 'warning' | 'info', title: string, detail: string } | null} */
	let statusMessage = null;

	const dispatch = createEventDispatcher();

	/** @typedef {{ status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string }} ManualConnectResult */

	onMount(() => {
		void refreshBootstrapMultiaddrs();
	});

	async function refreshBootstrapMultiaddrs() {
		isDiscovering = true;
		discoveryError = null;
		try {
			const { discoverAlephBootstrapMultiaddrs } = await import('@le-space/aleph-bootstrap');
			const discovered = await discoverAlephBootstrapMultiaddrs({ browserDialableOnly: true });
			discoveredMultiaddrs = selectValidBrowserBootstrapMultiaddrs(discovered);
			if (
				discoveredMultiaddrs.length > 0 &&
				(!selectedMultiaddr || !discoveredMultiaddrs.includes(selectedMultiaddr))
			) {
				selectedMultiaddr = discoveredMultiaddrs[0];
			}
		} catch (error) {
			discoveredMultiaddrs = [];
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
				bind:value={selectedMultiaddr}
				disabled={disabled || isConnecting || isDiscovering || discoveredMultiaddrs.length === 0}
				class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
			>
				{#if isDiscovering}
					<option value="">Discovering Aleph relays…</option>
				{:else if discoveredMultiaddrs.length === 0}
					<option value="">No relay addresses discovered</option>
				{:else}
					{#each discoveredMultiaddrs as address}
						<option value={address}>{describeBootstrapMultiaddr(address)}</option>
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
				No current browser-dialable relays were found. Refresh or enter a custom multiaddress.
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
