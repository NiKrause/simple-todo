<script>
	import { _ } from '$lib/i18n/index.js';
	// Open a shared todo list by its full OrbitDB address (acl01 chapter).
	// With per-creator access controllers the same mnemonic no longer yields
	// the same address for everyone, so lists are shared as addresses again.
	import { loadTodoDatabase } from './db-actions.js';

	let address = '';
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;

	async function open() {
		busy = true;
		errorMessage = null;
		try {
			await loadTodoDatabase(address);
			address = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}
</script>

<section
	class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="open-database-form"
>
	<h2 class="text-lg font-semibold text-heading">{$_('tech.openByAddress')}</h2>
	<p class="mt-1 text-xs text-faint">
		Paste the full OrbitDB address someone shared with you. You can read it right away — writing
		needs a permission grant from the owner.
	</p>
	<div class="mt-3 flex gap-2">
		<input
			type="text"
			bind:value={address}
			placeholder="/orbitdb/…"
			data-testid="open-db-address-input"
			class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs"
		/>
		<button
			type="button"
			on:click={open}
			disabled={busy || !address.trim()}
			data-testid="open-db-button"
			class="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
		>
			{busy ? $_('tech.opening') : $_('tech.openList')}
		</button>
	</div>
	{#if errorMessage}
		<p class="mt-2 text-xs text-red-600" data-testid="open-db-error">{errorMessage}</p>
	{/if}
</section>
