<script>
	import { createEventDispatcher } from 'svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	import { loadTodoDatabase } from './db-actions.js';

	export let disabled = false;

	let dbAddress = '';
	let isLoading = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ title: string, detail: string } | null} */
	let statusMessage = null;

	const dispatch = createEventDispatcher();

	async function handleLoad() {
		const address = dbAddress.trim();

		if (!address) {
			errorMessage = 'Enter an OrbitDB database address.';
			statusMessage = null;
			return;
		}

		if (!address.startsWith('/orbitdb/')) {
			errorMessage = 'The database address must start with "/orbitdb/".';
			statusMessage = null;
			return;
		}

		errorMessage = null;
		statusMessage = {
			title: 'Loading Todo DB',
			detail: 'Opening the OrbitDB database and loading todos...'
		};
		isLoading = true;

		try {
			const result = await loadTodoDatabase(address);
			statusMessage = {
				title: 'Todo DB loaded',
				detail: `Loaded ${result.count} todo${result.count === 1 ? '' : 's'}.`
			};
			dispatch('loaded', result);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			statusMessage = null;
		} finally {
			isLoading = false;
		}
	}

	/**
	 * @param {KeyboardEvent} event
	 */
	function handleKeydown(event) {
		if (event.key === 'Enter') {
			handleLoad();
		}
	}
</script>

<div class="mb-6 rounded-lg bg-white p-6 shadow-md">
	<div class="mb-4 flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold">Load Todo DB</h2>
			<p class="mt-1 text-sm text-gray-500">
				Load a shared OrbitDB todo list when you already know its database address.
			</p>
		</div>
	</div>

	<div class="space-y-4">
		<input
			type="text"
			bind:value={dbAddress}
			placeholder="/orbitdb/zdpu..."
			disabled={disabled || isLoading}
			class="w-full rounded-md border border-gray-300 px-4 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
			on:keydown={handleKeydown}
		/>

		{#if errorMessage}
			<ErrorAlert error={errorMessage} />
		{/if}

		{#if statusMessage}
			<ErrorAlert error={statusMessage.detail} type="info" title={statusMessage.title} />
		{/if}

		<div class="flex gap-2">
			<button
				on:click={handleLoad}
				disabled={disabled || isLoading}
				class="rounded-md bg-slate-800 px-6 py-2 font-medium text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-gray-400"
			>
				{isLoading ? 'Loading...' : 'Load Todo DB'}
			</button>
		</div>
	</div>
</div>
