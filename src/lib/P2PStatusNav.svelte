<script>
	import { onDestroy } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { relayDescription } from './relay-description.js';
	import { relayHttpStatusStore } from './relay-status.js';
	import { relayHttpOriginForPeer } from './multiaddr-utils.js';
	import { getRelayBootstrapAddrs } from './relay-bootstrap-addrs.js';

	/** @typedef {'pending' | 'active' | 'complete' | 'error'} StepStatus */
	/**
	 * A step names itself with a key; the sentence comes from the catalogue.
	 *
	 * `description` is optional and overrides the lookup — the relay step is the
	 * only one that has it, because its sentence carries an origin and a version
	 * that no catalogue can hold.
	 *
	 * @typedef {{ key: string, status: StepStatus, description?: string }} StatusStep
	 */

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
			key: 'relay',
			// The only step whose description is assembled rather than looked up:
			// it names the relay's origin and version, which no catalogue can hold.
			description: relayDescription($_, {
				connected: relayConnected,
				origin: relayHealthOrigin,
				health: relayHealthStatus,
				version: relayVersion
			}),
			status: relayConnected ? 'complete' : initializationComplete ? 'active' : 'pending'
		},
		{
			key: 'webrtc',
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
			startRelayHealthCheck(configuredRelayHttpOrigin, connection);
			return;
		}
		const origin = relayHttpOriginForPeer(
			connection.remotePeer?.toString() ?? '',
			getRelayBootstrapAddrs(),
			address
		);
		if (!origin) {
			if (relayHealthKey !== address) {
				resetRelayHealth();
				relayHealthKey = address;
			}
			return;
		}

		startRelayHealthCheck(origin, connection);
	}

	/** @param {string} origin @param {any} connection */
	function startRelayHealthCheck(origin, connection) {
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
			if (peerId && health.peerId !== peerId) throw new Error($_('status.relayIdMismatch'));
			if (relayHealthKey !== key) return;
			relayVersion = getHealthVersion(health);
			relayHealthStatus = 'verified';
		} catch {
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
		if (complete) return $_('status.ready');
		// By key, not by label. Comparing the English sentence would have made the
		// summary line depend on which language somebody happened to be reading.
		if (step?.key === 'relay') return $_('status.connectingRelay');
		if (step?.key === 'webrtc') return $_('status.waitingWebrtc');
		if (step?.status === 'error')
			return $_('status.failedToInitialize', { values: { step: stepLabel(step) } });
		if (step) return $_('status.initializing', { values: { step: stepLabel(step) } });
		return $_('status.preparing');
	}

	/** @param {StatusStep} step */
	function stepLabel(step) {
		return $_(`status.step.${step.key}.label`);
	}

	/**
	 * A step's description: assembled for the relay, looked up for the rest.
	 *
	 * @param {StatusStep} step
	 */
	function stepDescription(step) {
		return step.description ?? $_(`status.step.${step.key}.description`);
	}

	onDestroy(() => {
		removeConnectionListeners();
		resetRelayHealth();
	});
</script>

<nav
	class="mb-6 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
	aria-label={$_('status.aria')}
	data-testid="p2p-status-nav"
>
	<div class="mb-2 flex items-center gap-2 text-sm font-medium text-text" aria-live="polite">
		{#if !allComplete}
			<span
				class="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-blue-600"
				aria-hidden="true"
				data-testid="p2p-status-spinner"
			></span>
		{/if}
		<span>{statusLabel}</span>
	</div>

	<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
		{#each allSteps as step (step.key)}
			<div
				class="flex cursor-help items-center gap-2 text-xs whitespace-nowrap text-faint outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
				aria-label={`${stepLabel(step)}: ${stepDescription(step)}`}
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
					class:bg-cyan-500={step.status === 'active'}
					class:bg-identity-500={step.status === 'complete'}
					class:bg-danger-500={step.status === 'error'}
					class:bg-surface-2={step.status === 'pending'}
					class="h-2 w-2 rounded-full shadow-sm"
					aria-hidden="true"
				></span>
				<span class:text-text={step.status === 'active'}>{stepLabel(step)}</span>
			</div>
		{/each}
	</div>

	{#if tooltipStep}
		<div
			class="mt-3 rounded-md border border-border bg-code px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
			role="tooltip"
			data-testid="p2p-status-tooltip"
		>
			<span class="font-semibold">{stepLabel(tooltipStep)}:</span>
			{stepDescription(tooltipStep)}
		</div>
	{/if}

	{#if $$slots.default}
		<details class="group mt-3 border-t border-border pt-2" data-testid="network-details">
			<summary
				class="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-1 text-xs font-medium text-text outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500 [&::-webkit-details-marker]:hidden"
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
				<span>{$_('status.details')}</span>
				<span class="font-normal text-faint"
					>· {$_('status.peerCount', { values: { count: connectedPeerCount } })}</span
				>
				{#if peerId}
					<code class="hidden font-mono font-normal text-faint sm:inline"
						>· {peerId.slice(0, 8)}…{peerId.slice(-6)}</code
					>
				{/if}
			</summary>
			<!--
				Grid items default to `min-width: auto`, so a track refuses to shrink
				below its content: the relay select, a peer id and a multiaddress are
				all long unbreakable strings, which pushed these panels to 850px inside
				a 698px card on a folded Galaxy Fold and clipped them at the edge.
			-->
			<div class="mt-3 grid gap-3 border-t border-border pt-3 lg:grid-cols-3 [&>*]:min-w-0">
				<slot />
			</div>
		</details>
	{/if}
</nav>
