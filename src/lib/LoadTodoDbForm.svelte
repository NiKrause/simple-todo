<script>
	import { createEventDispatcher } from 'svelte';
	import { Check, Clipboard } from 'lucide-svelte';
	import ErrorAlert from './ErrorAlert.svelte';
	import { loadTodoDatabase, todoDBAddressStore } from './db-actions.js';

	export let disabled = false;

	let dbAddress = '';
	let hasEditedAddress = false;
	let isLoading = false;
	let copied = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ title: string, detail: string } | null} */
	let statusMessage = null;

	const dispatch = createEventDispatcher();

	$: currentTodoDbAddress = $todoDBAddressStore;
	$: if (currentTodoDbAddress && !hasEditedAddress && dbAddress !== currentTodoDbAddress) {
		dbAddress = currentTodoDbAddress;
	}

	function handleAddressInput() {
		hasEditedAddress = true;
	}

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
			dbAddress = result.address;
			hasEditedAddress = false;
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

	async function copyToClipboard() {
		const address = dbAddress.trim();
		if (!address) return;

		try {
			await navigator.clipboard.writeText(address);
			markCopied();
		} catch (error) {
			console.warn('Failed to copy Todo DB address:', error);
			fallbackCopyToClipboard(address);
		}
	}

	function markCopied() {
		copied = true;
		setTimeout(() => {
			copied = false;
		}, 2000);
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
			markCopied();
		} catch (error) {
			console.warn('Fallback copy failed:', error);
		}

		document.body.removeChild(textArea);
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
		<div class="flex gap-2">
			<input
				type="text"
				bind:value={dbAddress}
				placeholder="/orbitdb/zdpu..."
				disabled={disabled || isLoading}
				class="min-w-0 flex-1 rounded-md border border-gray-300 px-4 py-2 font-mono text-sm focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
				on:input={handleAddressInput}
				on:keydown={handleKeydown}
			/>
			<button
				type="button"
				on:click={copyToClipboard}
				disabled={!dbAddress.trim()}
				class="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-gray-300 text-gray-600 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
				title={copied ? 'Copied!' : 'Copy Todo DB address'}
				aria-label={copied ? 'Copied Todo DB address' : 'Copy Todo DB address'}
			>
				{#if copied}
					<Check class="h-4 w-4 text-green-600" />
				{:else}
					<Clipboard class="h-4 w-4" />
				{/if}
			</button>
		</div>

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
