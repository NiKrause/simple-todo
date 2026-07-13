<script>
	import { createEventDispatcher } from 'svelte';

	export let mnemonic = '';
	export let databaseAddress = '';

	let copied = false;
	const dispatch = createEventDispatcher();

	async function copyMnemonic() {
		if (!mnemonic) return;
		await navigator.clipboard.writeText(mnemonic);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<details
	class="mb-6 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm"
	data-testid="shared-list-details"
>
	<summary class="cursor-pointer text-sm font-semibold text-gray-700">Shared list</summary>
	<div class="mt-3 border-t border-gray-100 pt-3">
		<p class="text-xs text-gray-500">Public mnemonic / OrbitDB database name</p>
		<div class="mt-1 flex items-center gap-2 rounded-md bg-blue-50 p-2">
			<code class="min-w-0 flex-1 font-mono text-xs break-all" data-testid="active-shared-list-name"
				>{mnemonic}</code
			>
			<button
				type="button"
				on:click={copyMnemonic}
				class="rounded border border-blue-200 bg-white px-2 py-1 text-xs"
			>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>
		{#if databaseAddress}
			<p class="mt-2 text-xs text-gray-500">OrbitDB address</p>
			<code
				class="mt-1 block font-mono text-[11px] break-all text-gray-600"
				data-testid="active-database-address">{databaseAddress}</code
			>
		{/if}
		<p class="mt-2 text-xs text-amber-700">
			Anyone who knows this share code can discover and edit this public list.
		</p>
		<button
			type="button"
			on:click={() => dispatch('change')}
			class="mt-3 text-xs font-medium text-blue-700 underline"
		>
			Open another shared list
		</button>
	</div>
</details>
