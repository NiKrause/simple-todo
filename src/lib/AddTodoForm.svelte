<script>
	import { createEventDispatcher } from 'svelte';

	export let placeholder = 'What needs to be done?';
	export let buttonText = 'Add TODO';
	export let disabled = false;

	let inputText = '';
	const dispatch = createEventDispatcher();

	function handleSubmit() {
		if (!inputText || inputText.trim() === '') return;

		dispatch('add', {
			text: inputText.trim()
		});

		inputText = '';
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
