<script>
	import { createEventDispatcher } from 'svelte';

	export let mnemonic = '';
	export let databaseAddress = '';
	export let embedded = false;

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
	class="group"
	class:mb-6={!embedded}
	class:rounded-lg={!embedded}
	class:border={!embedded}
	class:border-border={true}
	class:bg-surface={!embedded}
	class:px-4={!embedded}
	class:py-3={!embedded}
	class:shadow-sm={!embedded}
	class:border-t={embedded}
	class:pt-2={embedded}
	data-testid="shared-list-details"
>
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
		<span>Shared list</span>
		{#if mnemonic}
			<code class="hidden min-w-0 truncate font-mono font-normal text-faint sm:inline"
				>· {mnemonic}</code
			>
		{/if}
	</summary>
	<div class="mt-3 border-t border-border pt-3">
		<p class="text-xs text-faint">Public mnemonic / OrbitDB database name</p>
		<div class="mt-1 flex items-center gap-2 rounded-md bg-cyan-50 p-2">
			<code class="min-w-0 flex-1 font-mono text-xs break-all" data-testid="active-shared-list-name"
				>{mnemonic}</code
			>
			<button
				type="button"
				on:click={copyMnemonic}
				class="rounded border border-cyan-200 bg-surface px-2 py-1 text-xs"
			>
				{copied ? 'Copied!' : 'Copy'}
			</button>
		</div>
		{#if databaseAddress}
			<p class="mt-2 text-xs text-faint">OrbitDB address</p>
			<code
				class="mt-1 block font-mono text-[11px] break-all text-text"
				data-testid="active-database-address">{databaseAddress}</code
			>
		{/if}
		<p class="mt-2 text-xs text-data-700">
			Anyone who knows this share code can open the same public database and edit it once connected.
		</p>
		<p class="mt-1 text-xs text-faint">
			The mnemonic selects the same database. Live replication also requires a connection to
			another browser peer.
		</p>
		<button
			type="button"
			on:click={() => dispatch('change')}
			class="mt-3 text-xs font-medium text-cyan-700 underline"
		>
			Open another shared list
		</button>
	</div>
</details>
