<script>
	import { formatPeerId } from './utils.js';

	/** @type {string | null | undefined} */
	export let peerId = null;
	export let title = 'My Peer ID';
	export let description = 'Share this ID with others to assign TODOs to you.';
	export let loadingMessage = 'Loading...';
	export let copyable = true;
	export let compact = false;

	let copied = false;

	async function copyToClipboard() {
		if (!peerId || !copyable) return;

		try {
			await navigator.clipboard.writeText(peerId);
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (err) {
			console.warn('Failed to copy to clipboard:', err);
			// Fallback for older browsers
			fallbackCopyToClipboard(peerId);
		}
	}

	/**
	 * @param {string} text
	 */
	function fallbackCopyToClipboard(text) {
		const textArea = document.createElement('textarea');
		textArea.value = text;
		textArea.style.position = 'fixed';
		textArea.style.left = '-999999px';
		textArea.style.top = '-999999px';
		document.body.appendChild(textArea);
		textArea.focus();
		textArea.select();

		try {
			document.execCommand('copy');
			copied = true;
			setTimeout(() => {
				copied = false;
			}, 2000);
		} catch (err) {
			console.warn('Fallback copy failed:', err);
		}

		document.body.removeChild(textArea);
	}
</script>

<div class:rounded-lg={!compact} class:bg-white={!compact} class:p-6={!compact} class:shadow-md={!compact}>
	<h2 class:mb-4={!compact} class:mb-2={compact} class:text-xl={!compact} class:text-sm={compact} class="font-semibold">{title}</h2>
	{#if peerId}
		<div class="relative rounded-md bg-blue-50" class:p-3={!compact} class:p-2={compact}>
			<code class="block truncate pr-7 font-mono text-xs select-all" title={peerId}>{formatPeerId(peerId)}</code>
			{#if copyable}
				<button
					on:click={copyToClipboard}
					class="absolute top-2 right-2 rounded p-1 transition-colors hover:bg-blue-200"
					title={copied ? 'Copied!' : 'Copy to clipboard'}
				>
					{#if copied}
						<svg
							class="h-4 w-4 text-green-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M5 13l4 4L19 7"
							></path>
						</svg>
					{:else}
						<svg
							class="h-4 w-4 text-gray-600"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
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
			{/if}
		</div>
		{#if description && !compact}
			<p class="mt-2 text-sm text-gray-600">{description}</p>
		{/if}
		{#if copied}
			<p class="mt-1 text-sm font-medium text-green-600">Copied to clipboard!</p>
		{/if}
	{:else}
		<p class="text-gray-500">{loadingMessage}</p>
	{/if}
</div>
