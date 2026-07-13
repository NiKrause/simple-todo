<script>
	import { createEventDispatcher } from 'svelte';
	import TodoItem from './TodoItem.svelte';
	import { todoReplicationStatusStore } from './db-actions.js';

	/** @typedef {{ id: string, text: string, completed: boolean, assignee: string | null, createdBy: string, key: string }} TodoItemData */

	/** @type {TodoItemData[]} */
	export let todos = [];
	export let title = 'TODO Items';
	export let emptyMessage = 'No TODOs yet. Add one above!';

	const dispatch = createEventDispatcher();

	/**
	 * @param {CustomEvent<{ key: string }>} event
	 */
	function handleDelete(event) {
		dispatch('delete', event.detail);
	}

	/**
	 * @param {CustomEvent<{ key: string }>} event
	 */
	function handleToggleComplete(event) {
		dispatch('toggleComplete', event.detail);
	}
</script>

<div class="mb-6 rounded-lg bg-white p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">{title} ({todos.length})</h2>
	{#if todos.length > 0}
		<div class="space-y-3">
			{#each todos as { id, text, completed, assignee, createdBy, key } (key)}
				<TodoItem
					{id}
					{text}
					{completed}
					{assignee}
					{createdBy}
					replicationStatus={$todoReplicationStatusStore[key] ?? 'unknown'}
					todoKey={key}
					on:delete={handleDelete}
					on:toggleComplete={handleToggleComplete}
				/>
			{/each}
		</div>
	{:else}
		<p class="py-8 text-center text-gray-500">{emptyMessage}</p>
	{/if}
</div>
