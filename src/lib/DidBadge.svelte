<script>
	// Shows the session's own DID (shortened) with a copy button. Rendered only
	// when the user chose a passkey identity in the onboarding.
	export let did = '';

	let copied = false;

	function shortDid(/** @type {string} */ value) {
		if (value.length <= 24) return value;
		return `${value.slice(0, 14)}…${value.slice(-6)}`;
	}

	async function copyDid() {
		try {
			await navigator.clipboard.writeText(did);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (error) {
			console.warn('Clipboard unavailable:', error);
		}
	}
</script>

{#if did}
	<div
		class="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs dark:border-emerald-700 dark:bg-emerald-950"
		data-testid="own-did-badge"
		title={did}
	>
		<span class="font-semibold text-emerald-700 dark:text-emerald-300">Passkey DID</span>
		<code class="font-mono" data-testid="own-did-value" data-did={did}>{shortDid(did)}</code>
		<button
			type="button"
			on:click={copyDid}
			class="rounded border border-emerald-300 px-1.5 py-0.5 hover:bg-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900"
			data-testid="own-did-copy"
		>
			{copied ? 'Copied ✓' : 'Copy'}
		</button>
	</div>
{/if}
