<script>
	import { onDestroy } from 'svelte';
	import { relayHttpStatusStore } from './relay-status.js';

	/** @typedef {'pending' | 'active' | 'complete' | 'error'} StepStatus */
	/** @typedef {{ label: string, description: string, status: StepStatus }} StatusStep */

	/** @type {{ isInitializing: boolean, isInitialized: boolean, error: string | null, steps: StatusStep[] }} */
	export let initialization;
	/** @type {any} */
	export let libp2p = null;
	/** @type {string | null} */
	export let peerId = null;

	/** @type {any} */
	let observedLibp2p = null;
	let relayConnected = false;
	let webRTCConnected = false;
	let connectedPeerCount = 0;
	let relayHealthKey = '';
	let relayHealthOrigin = '';
	let relayVersion = '';
	/** @type {'idle' | 'loading' | 'verified' | 'unavailable'} */
	let relayHealthStatus = 'idle';
	/** @type {AbortController | null} */
	let relayHealthController = null;
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
	const configuredRelayHttpOrigin = String(import.meta.env.VITE_RELAY_HTTP_ORIGIN || '').replace(
		/\/$/,
		''
	);

	$: initializationComplete = initialization?.isInitialized === true;
	$: connectivitySteps = [
		{
			label: 'Relay connected',
			description: getRelayDescription(),
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
		resetRelayHealth();
		observedLibp2p = node;
		relayConnected = false;
		webRTCConnected = false;
		connectedPeerCount = 0;

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
		const connections = node.getConnections?.() ?? [];
		const addresses = connections
			.map((/** @type {any} */ connection) => connection.remoteAddr?.toString().toLowerCase())
			.filter(Boolean);
		connectedPeerCount = new Set(
			connections
				.map((/** @type {any} */ connection) => connection.remotePeer?.toString())
				.filter(Boolean)
		).size;

		const relayConnection = connections.find((/** @type {any} */ connection) => {
			const address = connection.remoteAddr?.toString().toLowerCase() ?? '';
			return (
				(address.includes('/ws') || address.includes('/wss')) && !address.includes('/p2p-circuit')
			);
		});
		relayConnected = Boolean(relayConnection);
		updateRelayHealth(relayConnection);
		webRTCConnected = addresses.some((/** @type {string} */ address) =>
			address.includes('/webrtc')
		);
	}

	/** @param {any} connection */
	function updateRelayHealth(connection) {
		if (!connection) {
			resetRelayHealth();
			return;
		}

		const address = connection.remoteAddr?.toString() ?? '';
		if (configuredRelayHttpOrigin) {
			startRelayHealthCheck(configuredRelayHttpOrigin, connection, address);
			return;
		}
		const match = address.match(/\/dns[46]\/([^/]+)\/tcp\/(\d+)\/(?:tls\/)?(?:ws|wss)(?:\/|$)/i);
		if (!match) {
			if (relayHealthKey !== address) {
				resetRelayHealth();
				relayHealthKey = address;
			}
			return;
		}

		const origin = `https://${match[1]}${match[2] === '443' ? '' : `:${match[2]}`}`;
		startRelayHealthCheck(origin, connection, address);
	}

	/** @param {string} origin @param {any} connection @param {string} address */
	function startRelayHealthCheck(origin, connection, address) {
		const peerId = connection.remotePeer?.toString() ?? '';
		const key = `${origin}|${peerId}`;
		if (key === relayHealthKey) return;

		resetRelayHealth();
		relayHealthKey = key;
		relayHealthOrigin = origin;
		relayHttpStatusStore.set({ origin, peerId });
		relayHealthStatus = 'loading';
		relayHealthController = new AbortController();
		void fetchRelayHealth(origin, peerId, relayHealthController, key);
	}

	/** @param {string} origin @param {string} peerId @param {AbortController} controller @param {string} key */
	async function fetchRelayHealth(origin, peerId, controller, key) {
		let didTimeout = false;
		const timeout = setTimeout(() => {
			didTimeout = true;
			controller.abort();
		}, 5000);
		try {
			const response = await fetch(`${origin}/health`, { signal: controller.signal });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const health = await response.json();
			if (peerId && health.peerId !== peerId) throw new Error('Relay peer ID does not match');
			if (relayHealthKey !== key) return;
			relayVersion = getHealthVersion(health);
			relayHealthStatus = 'verified';
		} catch (error) {
			if (relayHealthKey === key && (didTimeout || !controller.signal.aborted))
				relayHealthStatus = 'unavailable';
		} finally {
			clearTimeout(timeout);
		}
	}

	/** @param {any} health */
	function getHealthVersion(health) {
		return String(
			health?.orbitdbRelayVersion ??
				health?.relayVersion ??
				health?.version ??
				health?.packageVersion ??
				health?.package?.version ??
				''
		);
	}

	function getRelayDescription() {
		const base =
			'A live WebSocket connection to a relay/bootstrap peer is available for discovery, pubsub and circuit relay traffic.';
		if (!relayConnected) return `${base} No relay is connected yet.`;
		if (!relayHealthOrigin)
			return `${base} No HTTPS health URL can be derived from the connected relay address.`;
		if (relayHealthStatus === 'loading')
			return `${base} Reading the OrbitDB relay version from ${relayHealthOrigin}/health…`;
		if (relayHealthStatus === 'verified' && relayVersion)
			return `${base} OrbitDB relay version ${relayVersion}; health and peer ID verified at ${relayHealthOrigin}/health.`;
		if (relayHealthStatus === 'verified')
			return `${base} Health and peer ID verified at ${relayHealthOrigin}/health. This relay does not expose its OrbitDB relay version.`;
		return `${base} ${relayHealthOrigin}/health could not be verified, so its OrbitDB relay version is unavailable.`;
	}

	function resetRelayHealth() {
		relayHealthController?.abort();
		relayHealthController = null;
		relayHealthKey = '';
		relayHealthOrigin = '';
		relayVersion = '';
		relayHealthStatus = 'idle';
		relayHttpStatusStore.set({ origin: '', peerId: '' });
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

	onDestroy(() => {
		removeConnectionListeners();
		resetRelayHealth();
	});
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

	{#if $$slots.default}
		<details class="group mt-3 border-t border-gray-100 pt-2" data-testid="network-details">
			<summary
				class="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-xs font-medium text-gray-600 outline-none hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-500 [&::-webkit-details-marker]:hidden"
			>
				<svg
					class="h-3.5 w-3.5 transition-transform group-open:rotate-90"
					viewBox="0 0 20 20"
					fill="currentColor"
					aria-hidden="true"
				>
					<path
						fill-rule="evenodd"
						d="M7.2 4.7a1 1 0 011.4 0l4.6 4.6a1 1 0 010 1.4l-4.6 4.6a1 1 0 11-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 010-1.4z"
						clip-rule="evenodd"
					/>
				</svg>
				<span>Network details</span>
				<span class="font-normal text-gray-400"
					>· {connectedPeerCount} {connectedPeerCount === 1 ? 'peer' : 'peers'}</span
				>
				{#if peerId}
					<code class="hidden font-mono font-normal text-gray-400 sm:inline"
						>· {peerId.slice(0, 8)}…{peerId.slice(-6)}</code
					>
				{/if}
			</summary>
			<div
				class="mt-3 grid min-w-0 gap-3 border-t border-gray-100 pt-3 lg:grid-cols-3 [&>*]:min-w-0"
			>
				<slot />
			</div>
		</details>
	{/if}

	<slot name="shared-list" />
</nav>
