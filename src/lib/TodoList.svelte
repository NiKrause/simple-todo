<script>
	import { createEventDispatcher } from 'svelte';
	import TodoItem from './TodoItem.svelte';
	import { todoReplicationStatusStore } from './db-actions.js';

	/** @typedef {{ id: string, text: string, completed: boolean, assignee: string | null, createdBy: string, author?: string, key: string, createdByIdentity?: string | null, delegation?: import('./delegation.js').Delegation | null, updatedBy?: string }} TodoItemData */

	/** @type {TodoItemData[]} */
	export let todos = [];
	export let title = 'TODO Items';
	export let emptyMessage = 'No TODOs yet. Add one above!';
	// delegation01
	/** @type {string | null} */
	export let currentIdentityId = null;
	export let delegationEnabled = false;

	const dispatch = createEventDispatcher();

	/** Re-dispatch a row's event under the same name. @param {string} name */
	const forward = (name) => (/** @type {CustomEvent} */ event) => dispatch(name, event.detail);
</script>

<div class="mb-6 rounded-lg bg-surface p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">{title} ({todos.length})</h2>
	{#if todos.length > 0}
		<div class="space-y-3">
			{#each todos as { id, text, completed, assignee, createdBy, author, key, createdByIdentity, delegation, updatedBy } (key)}
				<TodoItem
					{id}
					{text}
					{completed}
					{assignee}
					{createdBy}
					{author}
					createdByIdentity={createdByIdentity ?? null}
					delegation={delegation ?? null}
					{updatedBy}
					{currentIdentityId}
					{delegationEnabled}
					replicationStatus={$todoReplicationStatusStore[key] ?? 'unknown'}
					todoKey={key}
					on:delete={forward('delete')}
					on:toggleComplete={forward('toggleComplete')}
					on:updateText={forward('updateText')}
					on:delegate={forward('delegate')}
					on:revokeDelegation={forward('revokeDelegation')}
				/>
			{/each}
		</div>
	{:else}
		<p class="py-8 text-center text-faint">{emptyMessage}</p>
	{/if}
</div>
