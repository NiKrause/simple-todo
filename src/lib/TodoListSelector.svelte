<script>
	import { onMount } from 'svelte';
	import {
		currentTodoListNameStore,
		availableTodoListsStore,
		switchToTodoList,
		listAvailableTodoLists
	} from './todo-list-manager.js';
	import { initializationStore } from './p2p.js';
	import { get } from 'svelte/store';

	let showDropdown = false;
	let inputValue = '';
	let filteredLists = [];
	let isCreating = false;
	let isUserTyping = false; // Track if user is actively typing

	// Update inputValue when currentTodoListNameStore changes (but not when user is typing)
	$: if ($initializationStore.isInitialized && !isUserTyping && inputValue !== $currentTodoListNameStore) {
		inputValue = $currentTodoListNameStore || '';
	}

	$: {
		if ($availableTodoListsStore) {
			// If input is empty or matches current list, show all lists
			// Otherwise filter by input value
			if (inputValue === '' || inputValue === $currentTodoListNameStore) {
				filteredLists = $availableTodoListsStore;
			} else {
				filteredLists = $availableTodoListsStore.filter((list) =>
					list.displayName.toLowerCase().includes(inputValue.toLowerCase())
				);
			}
		}
	}

	onMount(() => {
		// Wait for initialization, then list available todo lists
		const unsubscribe = initializationStore.subscribe((state) => {
			if (state.isInitialized) {
				listAvailableTodoLists();
			}
		});
		return unsubscribe;
	});

	async function handleSelect(list) {
		showDropdown = false;
		isUserTyping = false; // Reset typing flag when selecting
		inputValue = list.displayName;
		const preferences = {
			enablePersistentStorage: true,
			enableNetworkConnection: true,
			enablePeerConnections: true
		};
		await switchToTodoList(list.displayName, preferences, false, '');
	}

	async function handleCreate() {
		if (!inputValue.trim()) return;

		const trimmedName = inputValue.trim();
		isCreating = true;
		showDropdown = false;

		const preferences = {
			enablePersistentStorage: true,
			enableNetworkConnection: true,
			enablePeerConnections: true
		};

		const success = await switchToTodoList(trimmedName, preferences, false, '');
		if (success) {
			inputValue = trimmedName;
		}
		isCreating = false;
	}

	async function handleInputFocus() {
		showDropdown = true;
		isUserTyping = false; // Reset typing flag on focus
		// Refresh the list when opening dropdown to ensure we have the latest data
		await listAvailableTodoLists();
		// Clear input to show all lists, user can type to filter
		inputValue = '';
	}

	function handleInputInput() {
		// Mark that user is actively typing
		isUserTyping = true;
	}

	function handleInputBlur() {
		// Reset typing flag when input loses focus
		isUserTyping = false;
		// Delay to allow click events on dropdown items
		setTimeout(() => {
			showDropdown = false;
		}, 200);
	}

	function handleKeydown(event) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (filteredLists.length === 1) {
				handleSelect(filteredLists[0]);
			} else {
				handleCreate();
			}
		} else if (event.key === 'Escape') {
			showDropdown = false;
		}
	}
</script>

<div class="relative w-full">
	<label for="todo-list-selector" class="block text-sm font-medium text-gray-700 mb-1">
		Todo List
	</label>
	<div class="relative">
		<input
			id="todo-list-selector"
			type="text"
			bind:value={inputValue}
			on:focus={handleInputFocus}
			on:blur={handleInputBlur}
			on:input={handleInputInput}
			on:keydown={handleKeydown}
			placeholder="Type to create or select a todo list..."
			class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 pr-10 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			disabled={isCreating || !$initializationStore.isInitialized}
		/>
		<button
			type="button"
			on:click={handleCreate}
			disabled={!inputValue.trim() || isCreating || !$initializationStore.isInitialized}
			class="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
			title="Create new todo list"
		>
			{isCreating ? '...' : '+'}
		</button>
	</div>

	{#if showDropdown && $initializationStore.isInitialized}
		<div
			class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-300 bg-white shadow-lg"
			role="listbox"
		>
			{#if filteredLists.length > 0}
				{#each filteredLists as list (list.dbName)}
					<button
						type="button"
						on:click={() => handleSelect(list)}
						class="w-full px-4 py-2 text-left text-sm hover:bg-blue-50 focus:bg-blue-50 focus:outline-none {list.displayName ===
						$currentTodoListNameStore
							? 'bg-blue-100 font-medium'
							: ''}"
						role="option"
					>
						{#if list.parent}
							<span class="flex items-center pl-6 text-gray-700">
								<span class="inline-block w-3 mr-2 text-gray-400 text-xs">└─</span>
								<span>{list.displayName}</span>
							</span>
						{:else}
							<span class="font-medium">{list.displayName}</span>
						{/if}
					</button>
				{/each}
			{/if}
			{#if inputValue.trim() && !filteredLists.some((l) => l.displayName.toLowerCase() === inputValue.trim().toLowerCase())}
				<button
					type="button"
					on:click={handleCreate}
					class="w-full px-4 py-2 text-left text-sm text-blue-600 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none border-t border-gray-200"
					role="option"
				>
					+ Create "{inputValue.trim()}"
				</button>
			{/if}
		</div>
	{/if}
</div>



