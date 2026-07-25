<script>
	// Create a new access-controlled private list (acl01). The public mnemonic
	// list stays available; this opens a fresh owner-only list and switches to
	// it, after which the permissions panel appears for granting DIDs.
	import { createPrivateTodoList } from './db-actions.js';

	let name = '';
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;

	async function create() {
		busy = true;
		errorMessage = null;
		try {
			await createPrivateTodoList(name);
			name = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}
</script>

<section
	class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="new-private-list"
>
	<h2 class="text-lg font-semibold text-heading">Create a private list</h2>
	<p class="mt-1 text-xs text-faint">
		Only your identity can write to it. Share its address and grant other DIDs below.
	</p>
	<div class="mt-3 flex gap-2">
		<input
			type="text"
			bind:value={name}
			placeholder="list name (optional)"
			data-testid="new-list-name"
			class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs"
		/>
		<button
			type="button"
			on:click={create}
			disabled={busy}
			data-testid="new-list-create"
			class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
		>
			{busy ? 'Creating…' : 'Create private list'}
		</button>
	</div>
	{#if errorMessage}
		<p class="mt-2 text-xs text-red-600" data-testid="new-list-error">{errorMessage}</p>
	{/if}
</section>
