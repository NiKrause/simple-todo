<script>
	import { onMount } from 'svelte';
	import { uniqueUsersStore, listUniqueUsers, availableTodoListsStore, selectedUserIdStore } from './todo-list-manager.js';
	import { initializationStore } from './p2p.js';
	import { showToast } from './toast-store.js';
	import { get } from 'svelte/store';

	let copiedUserId = null;
	let hoveredUserId = null;

	onMount(async () => {
		// Wait for initialization, then list unique users
		const unsubscribe = initializationStore.subscribe(async (state) => {
			if (state.isInitialized) {
				await listUniqueUsers();
			}
		});
		return unsubscribe;
	});

	// Refresh list when initialization completes or when todo lists change
	$: if ($initializationStore.isInitialized && $availableTodoListsStore.length >= 0) {
		listUniqueUsers();
	}

	// Compute user count text
	$: userCountText = $uniqueUsersStore.length === 1 ? 'user' : 'users';

	async function copyToClipboard(userId, event) {
		// Prevent selection if user is clicking to copy
		event.stopPropagation();
		try {
			await navigator.clipboard.writeText(userId);
			copiedUserId = userId;
			showToast('User ID copied to clipboard', 'success', 2000);
			setTimeout(() => {
				copiedUserId = null;
			}, 2000);
		} catch (error) {
			console.error('Failed to copy to clipboard:', error);
			showToast('Failed to copy to clipboard', 'error', 2000);
		}
	}

	function selectUser(userId, event) {
		// Toggle selection: if already selected, deselect (show all)
		const currentSelected = get(selectedUserIdStore);
		if (currentSelected === userId) {
			selectedUserIdStore.set(null); // Show all users
		} else {
			selectedUserIdStore.set(userId); // Filter to this user
		}
	}
</script>

<div class="w-full">
	<label for="users-list" class="block text-sm font-medium text-gray-700 mb-1">
		Users
	</label>
	<div
		id="users-list"
		class="min-h-[120px] max-h-48 w-full overflow-auto rounded-md border border-gray-300 bg-white text-sm shadow-sm"
	>
		{#if !$initializationStore.isInitialized}
			<div class="px-3 py-2 text-gray-500">Initializing...</div>
		{:else if $uniqueUsersStore.length === 0}
			<div class="px-3 py-2 text-gray-500">No users found</div>
		{:else}
			{#each $uniqueUsersStore as userId (userId)}
				<div class="group relative border-b border-gray-100 last:border-b-0">
					<button
						type="button"
						on:click={(e) => selectUser(userId, e)}
						on:mouseenter={() => (hoveredUserId = userId)}
						on:mouseleave={() => (hoveredUserId = null)}
						class="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-blue-50 focus:bg-blue-50 focus:outline-none transition-colors {$selectedUserIdStore === userId
							? 'bg-blue-100 font-medium'
							: copiedUserId === userId
							? 'bg-green-50'
							: ''}"
					>
						<div class="flex items-center justify-between">
							<div class="truncate font-mono flex-1">{userId}</div>
							{#if $selectedUserIdStore === userId}
								<span class="ml-2 text-blue-600 text-xs">✓</span>
							{/if}
						</div>
					</button>
					<!-- Tooltip showing full ID -->
					{#if hoveredUserId === userId}
						<div
							class="absolute left-0 top-full z-10 mt-1 max-w-xs rounded-md bg-gray-900 px-3 py-2 text-xs text-white shadow-lg"
							role="tooltip"
						>
							<div class="break-all font-mono">{userId}</div>
							<div class="mt-1 text-xs text-gray-400">Click to filter todo lists</div>
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
	<div class="mt-1 text-xs text-gray-500">
		{$uniqueUsersStore.length} unique {userCountText} found
		{#if $selectedUserIdStore}
			<span class="ml-2 text-blue-600">• Filtered to: {$selectedUserIdStore.slice(0, 8)}...</span>
		{/if}
	</div>
</div>
