<script>
	import { onDestroy } from 'svelte';

	/** @typedef {'pending' | 'active' | 'complete' | 'error'} StepStatus */
	/** @typedef {{ label: string, description: string, status: StepStatus }} StatusStep */

	/** @type {{ isInitializing: boolean, isInitialized: boolean, error: string | null, steps: StatusStep[] }} */
	export let initialization;
	/** @type {any} */
	export let libp2p = null;

	/** @type {any} */
	let observedLibp2p = null;
	let relayConnected = false;
	let webRTCConnected = false;
	/** @type {StatusStep[]} */
	let connectivitySteps = [];
	/** @type {StatusStep[]} */
	let allSteps = [];
	/** @type {StatusStep | undefined} */
	let currentStep;
	/** @type {StatusStep | null} */
	let tooltipStep = null;
	/** @type {Array<{ event: string, handler: () => void }>} */
	let connectionListeners = [];

	$: initializationComplete = initialization?.isInitialized === true;
	$: connectivitySteps = [
		{
			label: 'Relay connected',
			description:
				'A live WebSocket connection to a relay/bootstrap peer is available for discovery, pubsub and circuit relay traffic.',
			status: relayConnected ? 'complete' : initializationComplete ? 'active' : 'pending'
		},
		{
			label: 'WebRTC connected',
			description:
				'A live libp2p connection using WebRTC is available. This normally appears after another browser peer has been discovered.',
			status: webRTCConnected
				? 'complete'
				: initializationComplete && relayConnected
					? 'active'
					: 'pending'
		}
	];
	$: allSteps = [...(initialization?.steps ?? []), ...connectivitySteps];
	$: allComplete = allSteps.length > 0 && allSteps.every((step) => step.status === 'complete');
	$: currentStep =
		allSteps.find((step) => step.status === 'active') ??
		allSteps.find((step) => step.status === 'pending') ??
		allSteps.find((step) => step.status === 'error');
	$: statusLabel = getStatusLabel(allComplete, currentStep);

	$: if (libp2p !== observedLibp2p) {
		observeConnections(libp2p);
	}

	/** @param {any} node */
	function observeConnections(node) {
		removeConnectionListeners();
		observedLibp2p = node;
		relayConnected = false;
		webRTCConnected = false;

		if (!node) return;

		const update = () => updateConnectionState(node);
		for (const event of ['connection:open', 'connection:close']) {
			node.addEventListener(event, update);
			connectionListeners.push({ event, handler: update });
		}
		update();
	}

	/** @param {any} node */
	function updateConnectionState(node) {
		const addresses =
			node
				.getConnections?.()
				.map((/** @type {any} */ connection) => connection.remoteAddr?.toString().toLowerCase())
				.filter(Boolean) ?? [];

		relayConnected = addresses.some(
			(/** @type {string} */ address) =>
				(address.includes('/ws') || address.includes('/wss')) && !address.includes('/p2p-circuit')
		);
		webRTCConnected = addresses.some((/** @type {string} */ address) =>
			address.includes('/webrtc')
		);
	}

	function removeConnectionListeners() {
		if (observedLibp2p) {
			for (const { event, handler } of connectionListeners) {
				observedLibp2p.removeEventListener(event, handler);
			}
		}
		connectionListeners = [];
	}

	/**
	 * @param {boolean} complete
	 * @param {StatusStep | undefined} step
	 */
	function getStatusLabel(complete, step) {
		if (complete) return 'P2P network ready';
		if (step?.label === 'Relay connected') return 'Connecting to relay';
		if (step?.label === 'WebRTC connected') return 'Waiting for WebRTC connection';
		if (step?.status === 'error') return `Failed to initialize ${step.label}`;
		if (step) return `Initializing ${step.label}`;
		return 'Preparing P2P network';
	}

	onDestroy(removeConnectionListeners);
</script>

<nav
	class="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm"
	aria-label="P2P initialization and connection status"
	data-testid="p2p-status-nav"
>
	<div class="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700" aria-live="polite">
		{#if !allComplete}
			<span
				class="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600"
				aria-hidden="true"
				data-testid="p2p-status-spinner"
			></span>
		{/if}
		<span>{statusLabel}</span>
	</div>

	<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
		{#each allSteps as step}
			<div
				class="flex cursor-help items-center gap-2 text-xs whitespace-nowrap text-gray-500 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
				aria-label={`${step.label}: ${step.description}`}
				data-testid="p2p-status-step"
				data-status={step.status}
				role="button"
				tabindex="0"
				on:mouseenter={() => (tooltipStep = step)}
				on:mouseleave={() => (tooltipStep = null)}
				on:focus={() => (tooltipStep = step)}
				on:blur={() => (tooltipStep = null)}
			>
				<span
					class:animate-pulse={step.status === 'active'}
					class:bg-blue-500={step.status === 'active'}
					class:bg-green-500={step.status === 'complete'}
					class:bg-red-500={step.status === 'error'}
					class:bg-gray-300={step.status === 'pending'}
					class="h-2 w-2 rounded-full shadow-sm"
					aria-hidden="true"
				></span>
				<span class:text-gray-700={step.status === 'active'}>{step.label}</span>
			</div>
		{/each}
	</div>

	{#if tooltipStep}
		<div
			class="mt-3 rounded-md border border-slate-200 bg-slate-800 px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
			role="tooltip"
			data-testid="p2p-status-tooltip"
		>
			<span class="font-semibold">{tooltipStep.label}:</span>
			{tooltipStep.description}
		</div>
	{/if}
</nav>
