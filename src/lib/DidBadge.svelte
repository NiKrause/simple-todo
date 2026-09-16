<script>
	// Shows the session's own DID (shortened) with a copy button. Rendered only
	// when the user chose a passkey identity in the onboarding.
	//
	// escrow01: the auditor view shows its account the same way, under its own
	// label.
	import { _ } from '$lib/i18n/index.js';
	import { shortId } from './utils.js';

	export let did = '';
	/** What the identifier is; the passkey DID unless said otherwise. */
	/** @type {string | null} */
	export let label = null;

	let copied = false;

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
		<span class="font-semibold text-emerald-700 dark:text-emerald-300"
			>{label ?? $_('identity.passkeyDid')}</span
		>
		<code class="font-mono" data-testid="own-did-value" data-did={did}>{shortId(did)}</code>
		<button
			type="button"
			on:click={copyDid}
			class="rounded border border-emerald-300 px-1.5 py-0.5 hover:bg-emerald-100 dark:border-emerald-700 dark:hover:bg-emerald-900"
			data-testid="own-did-copy"
		>
			{copied ? $_('identity.copied') : $_('identity.copy')}
		</button>
	</div>
{/if}
