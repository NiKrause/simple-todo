<script>
	import { onDestroy } from 'svelte';

	/** @type {any} */
	export let libp2p = null;

	/** @type {any} */
	let observedLibp2p = null;
	/** @type {string[]} */
	let addresses = [];
	/** @type {string | null} */
	let copiedAddress = null;
	/** @type {Array<{ event: string, handler: () => void }>} */
	let listeners = [];
	/** @type {ReturnType<typeof setInterval> | null} */
	let refreshInterval = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let copiedTimeout = null;

	$: if (libp2p !== observedLibp2p) observeLibp2p(libp2p);

	/** @param {any} node */
	function observeLibp2p(node) {
		removeListeners();
		observedLibp2p = node;
		addresses = [];
		if (!node) return;

		const update = () => updateAddresses(node);
		for (const event of [
			'self:peer:update',
			'transport:listening',
			'transport:close',
			'connection:open',
			'connection:close'
		]) {
			node.addEventListener?.(event, update);
			listeners.push({ event, handler: update });
		}
		update();
		refreshInterval = setInterval(update, 2000);
	}

	/** @param {any} node */
	function updateAddresses(node) {
		const peerId = node.peerId?.toString?.() ?? '';
		const ownAddresses = node.getMultiaddrs?.() ?? [];
		const peerStoreAddresses = node.peerStore?.addressBook?.get?.(node.peerId)?.multiaddrs ?? [];
		addresses = Array.from(
			new Set(
				[...ownAddresses, ...peerStoreAddresses]
					.map((address) => address?.toString?.() ?? String(address ?? ''))
					.filter((address) => address.startsWith('/'))
					.filter(isBrowserDialableAddress)
					.map((address) => ensurePeerId(address, peerId))
			)
		).sort();
	}

	/** @param {string} address */
	function isBrowserDialableAddress(address) {
		const normalized = address.toLowerCase();
		return (
			normalized.includes('/ws') ||
			normalized.includes('/wss') ||
			normalized.includes('/webrtc') ||
			normalized.includes('/webrtc-direct')
		);
	}

	/** @param {string} address @param {string} peerId */
	function ensurePeerId(address, peerId) {
		if (!peerId || /\/(?:p2p|ipfs)\/[^/]+$/.test(address)) return address;
		return `${address}/p2p/${peerId}`;
	}

	/** @param {string} address */
	async function copyAddress(address) {
		try {
			await navigator.clipboard.writeText(address);
		} catch (error) {
			if (!fallbackCopy(address)) {
				console.warn('Failed to copy multiaddress:', error);
				return;
			}
		}

		copiedAddress = address;
		if (copiedTimeout) clearTimeout(copiedTimeout);
		copiedTimeout = setTimeout(() => (copiedAddress = null), 2000);
	}

	/** @param {string} address */
	function fallbackCopy(address) {
		const textArea = document.createElement('textarea');
		textArea.value = address;
		textArea.style.position = 'fixed';
		textArea.style.left = '-999999px';
		document.body.appendChild(textArea);
		textArea.select();
		let copied = false;
		try {
			copied = document.execCommand('copy');
		} finally {
			textArea.remove();
		}
		return copied;
	}

	function removeListeners() {
		if (observedLibp2p) {
			for (const { event, handler } of listeners) {
				observedLibp2p.removeEventListener?.(event, handler);
			}
		}
		listeners = [];
		if (refreshInterval) clearInterval(refreshInterval);
		refreshInterval = null;
	}

	onDestroy(() => {
		removeListeners();
		if (copiedTimeout) clearTimeout(copiedTimeout);
	});
</script>

<section class="max-w-full min-w-0 overflow-hidden" data-testid="own-multiaddrs">
	<div class="mb-2 flex items-baseline justify-between gap-2">
		<h2 class="text-sm font-semibold">My Multiaddresses</h2>
		<span class="text-xs text-gray-400">{addresses.length}</span>
	</div>
	<p class="mb-2 text-xs text-gray-500">Copy an address to connect another browser directly.</p>

	{#if addresses.length > 0}
		<ul
			class="max-h-28 max-w-full min-w-0 space-y-1 overflow-x-hidden overflow-y-auto pr-1"
			data-testid="own-multiaddr-list"
		>
			{#each addresses as address, index}
				<li
					class="flex max-w-full min-w-0 items-center gap-1 overflow-hidden rounded-md bg-blue-50 p-1.5"
				>
					<code class="w-0 min-w-0 flex-1 truncate font-mono text-[11px]" title={address}
						>{address}</code
					>
					<button
						type="button"
						on:click={() => copyAddress(address)}
						class="shrink-0 rounded p-1 text-gray-600 transition-colors hover:bg-blue-200 focus-visible:ring-2 focus-visible:ring-blue-500"
						aria-label={`Copy multiaddress ${index + 1}`}
						title={copiedAddress === address ? 'Copied!' : 'Copy to clipboard'}
						data-testid="copy-own-multiaddr"
						data-multiaddr={address}
					>
						{#if copiedAddress === address}
							<span class="text-xs font-semibold text-green-600" aria-hidden="true">✓</span>
						{:else}
							<svg
								class="h-4 w-4"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									stroke-width="2"
									d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
								></path>
							</svg>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
		<p class="sr-only" aria-live="polite">
			{copiedAddress ? 'Multiaddress copied to clipboard.' : ''}
		</p>
	{:else}
		<p class="text-xs text-gray-400">Waiting for a dialable address…</p>
	{/if}
</section>
