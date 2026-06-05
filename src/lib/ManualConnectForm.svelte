<script>
	import { createEventDispatcher } from 'svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	import { connectToMultiaddr } from './p2p.js';

	export let disabled = false;

	let multiaddr = '';
	let isConnecting = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ tone: 'success' | 'warning' | 'info', title: string, detail: string } | null} */
	let statusMessage = null;

	const dispatch = createEventDispatcher();

	/** @typedef {{ status: 'stable' | 'dropped', detail: string, remotePeer: string | null, remoteAddr: string }} ManualConnectResult */

	async function handleConnect() {
		const address = multiaddr.trim();

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
				multiaddr = '';
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

<div class="rounded-lg bg-white p-6 shadow-md">
	<div class="mb-4 flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold">Connect To Multiaddress</h2>
			<p class="mt-1 text-sm text-gray-500">
				Manually dial a peer or relay if you already know its browser-reachable address.
			</p>
		</div>
	</div>

	<div class="space-y-4">
		<input
			type="text"
			bind:value={multiaddr}
			placeholder="/dns4/example.com/tcp/443/wss/p2p/12D3KooW..."
			disabled={disabled || isConnecting}
			class="w-full rounded-md border border-gray-300 px-4 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
			on:keydown={handleKeydown}
		/>

		{#if errorMessage}
			<ErrorAlert error={errorMessage} />
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
			/>
		{/if}

		<div class="flex gap-2">
			<button
				on:click={handleConnect}
				disabled={disabled || isConnecting}
				class="rounded-md bg-slate-800 px-6 py-2 font-medium text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-gray-400"
			>
				{isConnecting ? 'Connecting...' : 'Connect'}
			</button>
		</div>
	</div>
</div>
