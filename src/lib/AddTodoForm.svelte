<script>
	import { createEventDispatcher } from 'svelte';

	export let placeholder = 'What needs to be done?';
	export let buttonText = 'Add TODO';
	export let disabled = false;
	/**
	 * delegation01: whether the active list's access controller accepts
	 * delegation actions. The shared mnemonic list (IPFS controller,
	 * `write: ['*']`) does not — everyone may write there anyway.
	 */
	export let delegationEnabled = false;

	let inputText = '';
	let showDelegation = false;
	let delegateDid = '';
	let delegationExpiresAt = '';
	const dispatch = createEventDispatcher();

	function handleSubmit() {
		if (!inputText || inputText.trim() === '') return;

		dispatch('add', {
			text: inputText.trim(),
			delegateDid: delegationEnabled && showDelegation ? delegateDid.trim() || null : null,
			// datetime-local gives a local wall-clock string; store it as an instant.
			delegationExpiresAt:
				delegationEnabled && showDelegation && delegationExpiresAt
					? new Date(delegationExpiresAt).toISOString()
					: null
		});

		inputText = '';
		delegateDid = '';
		delegationExpiresAt = '';
	}

	/**
	 * @param {KeyboardEvent} event
	 */
	function handleKeydown(event) {
		if (event.key === 'Enter') {
			handleSubmit();
		}
	}
</script>

<div class="mb-6 rounded-lg bg-surface p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">Add New TODO</h2>
	<div class="space-y-4">
		<input
			type="text"
			bind:value={inputText}
			{placeholder}
			{disabled}
			class="w-full rounded-md border border-border px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
			on:keydown={handleKeydown}
		/>

		{#if delegationEnabled}
			<label class="flex items-center gap-2 text-sm text-faint">
				<input
					type="checkbox"
					bind:checked={showDelegation}
					{disabled}
					class="h-4 w-4 rounded text-cyan-600 focus:ring-cyan-500"
					data-testid="add-todo-delegate-toggle"
				/>
				Delegate this todo to another DID
			</label>
		{/if}

		{#if delegationEnabled && showDelegation}
			<div class="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="add-todo-delegation">
				<div>
					<label for="add-todo-delegate-did" class="mb-1 block text-sm font-medium text-heading">
						Delegate DID
					</label>
					<input
						id="add-todo-delegate-did"
						type="text"
						bind:value={delegateDid}
						{disabled}
						placeholder="did:key:… of the person who may complete it"
						data-testid="add-todo-delegate-did"
						class="w-full rounded-md border border-border px-4 py-2 font-mono text-xs focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
					/>
				</div>
				<div>
					<label
						for="add-todo-delegation-expiry"
						class="mb-1 block text-sm font-medium text-heading"
					>
						Delegation expires at <span class="font-normal text-faint">(optional)</span>
					</label>
					<input
						id="add-todo-delegation-expiry"
						type="datetime-local"
						bind:value={delegationExpiresAt}
						{disabled}
						data-testid="add-todo-delegation-expiry"
						class="w-full rounded-md border border-border px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:bg-surface-2"
					/>
				</div>
				<p class="text-xs text-faint sm:col-span-2">
					The delegate does not get write access to the list. They may only complete or rename this
					one todo, and you can revoke that at any time.
				</p>
			</div>
		{/if}

		<div class="flex gap-2">
			<button
				on:click={handleSubmit}
				{disabled}
				class="rounded-md bg-coral-500 px-6 py-2 font-medium text-white transition-colors hover:bg-coral-600 disabled:cursor-not-allowed disabled:bg-faint"
			>
				{buttonText}
			</button>
		</div>
	</div>
</div>
