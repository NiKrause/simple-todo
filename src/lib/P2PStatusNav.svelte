<script>
	// escrow01: in the simple view this panel says in one sentence whether the
	// app is ready and connected. The steps behind that sentence — libp2p, Helia,
	// OrbitDB — and the network details wait in the technical view.
	//
	// The panel itself stays mounted in both views and on every tab: the relay
	// health check below publishes the relay's HTTP origin, and the replication
	// proof on every todo row asks that origin. Hiding the panel must not switch
	// the proof off. The same goes for the state it publishes for the header.
	import { onDestroy } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { networkStateStore } from './network-status.js';
	import { relayHttpStatusStore } from './relay-status.js';
	import { relayHttpOriginForPeer } from './multiaddr-utils.js';
	import { getRelayBootstrapAddrs } from './relay-bootstrap-addrs.js';
	import { technicalView } from './technical-view.js';

	/** @typedef {'pending' | 'active' | 'complete' | 'error'} StepStatus */
	/** @typedef {{ key: string, status: StepStatus }} StatusStep */
	/** @typedef {(id: string, options?: { values?: Record<string, string | number> }) => string} Format */

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
			key: 'relayConnected',
			status: relayConnected ? 'complete' : initializationComplete ? 'active' : 'pending'
		},
		{
			key: 'webrtcConnected',
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
	$: failed = Boolean(initialization?.error) || allSteps.some((step) => step.status === 'error');
	$: networkState = simpleState({
		failed,
		initialized: initializationComplete,
		relayConnected,
		webRTCConnected
	});
	$: networkStateStore.set(networkState);
	$: statusLabel = $technicalView
		? technicalStatus($_, allComplete, currentStep)
		: $_(`network.simple.${networkState}`);
	// The simple view stops spinning once the app can be used and reaches a relay;
	// waiting for a direct connection to another browser is the technical view's
	// business, and without a second browser it never ends.
	$: busy = $technicalView ? !allComplete : !failed && (!initializationComplete || !relayConnected);
	$: relayDescription = describeRelay($_, {
		connected: relayConnected,
		origin: relayHealthOrigin,
		health: relayHealthStatus,
		version: relayVersion
	});
	// A tooltip left open when the view switched would come back with it.
	$: if (!$technicalView) tooltipStep = null;
	// What each step is called and what it does, in the language on screen.
	$: stepTexts = Object.fromEntries(
		allSteps.map((step) => [
			step.key,
			{
				label: $_(`network.step.${step.key}.label`),
				description:
					step.key === 'relayConnected'
						? relayDescription
						: $_(`network.step.${step.key}.description`)
			}
		])
	);

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

	/**
	 * What the relay step stands for, and what is known about the relay behind it.
	 *
	 * @param {Format} format
	 * @param {{ connected: boolean, origin: string, health: 'idle' | 'loading' | 'verified' | 'unavailable', version: string }} relay
	 */
	function describeRelay(format, { connected, origin, health, version }) {
		const key = 'network.step.relayConnected';
		const base = format(`${key}.description`);
		const values = { origin, version };
		if (!connected) return `${base} ${format(`${key}.none`)}`;
		if (!origin) return `${base} ${format(`${key}.noOrigin`)}`;
		if (health === 'loading') return `${base} ${format(`${key}.loading`, { values })}`;
		if (health === 'verified' && version)
			return `${base} ${format(`${key}.verifiedVersion`, { values })}`;
		if (health === 'verified') return `${base} ${format(`${key}.verified`, { values })}`;
		return `${base} ${format(`${key}.unverified`, { values })}`;
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
	 * The technical view's status line: the step the start is at, by name.
	 *
	 * @param {Format} format
	 * @param {boolean} complete
	 * @param {StatusStep | undefined} step
	 */
	function technicalStatus(format, complete, step) {
		if (complete) return format('network.status.ready');
		if (step?.key === 'relayConnected') return format('network.status.connectingRelay');
		if (step?.key === 'webrtcConnected') return format('network.status.waitingWebrtc');
		if (!step) return format('network.status.preparing');
		const values = { step: format(`network.step.${step.key}.label`) };
		return step.status === 'error'
			? format('network.status.failed', { values })
			: format('network.status.initializing', { values });
	}

	/**
	 * The simple view's state: whether the app can be used, and how far it
	 * reaches — no component names. `network.simple.<state>` says it in a
	 * sentence, and the header's dot in a word.
	 *
	 * @param {{ failed: boolean, initialized: boolean, relayConnected: boolean, webRTCConnected: boolean }} state
	 * @returns {import('./network-status.js').NetworkState}
	 */
	function simpleState({ failed, initialized, relayConnected, webRTCConnected }) {
		if (failed) return 'failed';
		if (!initialized) return 'starting';
		if (!relayConnected) return 'connecting';
		return webRTCConnected ? 'direct' : 'relay';
	}

	onDestroy(() => {
		removeConnectionListeners();
		resetRelayHealth();
	});
</script>

<nav
	class="mb-6 rounded-lg border border-border bg-surface px-4 py-3 shadow-sm"
	aria-label={$_('network.navLabel')}
	data-testid="p2p-status-nav"
	data-view={$technicalView ? 'technical' : 'simple'}
>
	<div class="mb-2 flex items-center gap-2 text-sm font-medium text-text" aria-live="polite">
		{#if busy}
			<span
				class="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-blue-600"
				aria-hidden="true"
				data-testid="p2p-status-spinner"
			></span>
		{/if}
		<span data-testid="p2p-status-label">{statusLabel}</span>
	</div>

	{#if $technicalView}
		<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
			{#each allSteps as step (step.key)}
				<div
					class="flex cursor-help items-center gap-2 text-xs whitespace-nowrap text-faint outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
					aria-label={`${stepTexts[step.key]?.label}: ${stepTexts[step.key]?.description}`}
					data-testid="p2p-status-step"
					data-step={step.key}
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
					<span class:text-text={step.status === 'active'}>{stepTexts[step.key]?.label}</span>
				</div>
			{/each}
		</div>

		{#if tooltipStep}
			<div
				class="mt-3 rounded-md border border-border bg-code px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
				role="tooltip"
				data-testid="p2p-status-tooltip"
			>
				<span class="font-semibold">{stepTexts[tooltipStep.key]?.label}:</span>
				{stepTexts[tooltipStep.key]?.description}
			</div>
		{/if}
	{/if}

	<!-- Peer count, peer ID, manual relay connect, connected peers and multiaddrs:
	     the technical view's, and not rendered at all in the simple one. -->
	{#if $technicalView && $$slots.default}
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
				<span>{$_('network.details')}</span>
				<span class="font-normal text-faint"
					>· {$_('network.peerCount', { values: { count: connectedPeerCount } })}</span
				>
				{#if peerId}
					<code class="hidden font-mono font-normal text-faint sm:inline"
						>· {peerId.slice(0, 8)}…{peerId.slice(-6)}</code
					>
				{/if}
			</summary>
			<div class="mt-3 grid min-w-0 gap-3 border-t border-border pt-3 lg:grid-cols-3 [&>*]:min-w-0">
				<slot />
			</div>
		</details>
	{/if}
</nav>
