<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import TodoItem from './TodoItem.svelte';
	import { todoReplicationStatusStore } from './db-actions.js';
	import { isWellFormedBudget } from './budget.js';

	/** @typedef {{ id: string, text: string, completed: boolean, assignee: string | null, createdBy: string, author?: string, key: string, createdByIdentity?: string | null, delegation?: import('./delegation.js').Delegation | null, updatedBy?: string, budget?: import('./budget.js').Budget | null }} TodoItemData */

	/** @type {TodoItemData[]} */
	export let todos = [];
	/** @type {string | null} */
	export let title = null;
	/** @type {string | null} */
	export let emptyMessage = null;
	// delegation01
	/** @type {string | null} */
	export let currentIdentityId = null;
	export let delegationEnabled = false;

	const dispatch = createEventDispatcher();

	/** Re-dispatch a row's event under the same name. @param {string} name */
	const forward = (name) => (/** @type {CustomEvent} */ event) => dispatch(name, event.detail);
</script>

<div class="mb-6 rounded-lg bg-surface p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">{title ?? $_('todo.list.title')} ({todos.length})</h2>
	{#if todos.length > 0}
		<div class="space-y-3">
			{#each todos as { id, text, completed, assignee, createdBy, author, key, createdByIdentity, delegation, updatedBy, budget } (key)}
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
					budget={isWellFormedBudget(budget) ? budget : null}
					replicationStatus={$todoReplicationStatusStore[key] ?? 'unknown'}
					todoKey={key}
					on:delete={forward('delete')}
					on:toggleComplete={forward('toggleComplete')}
					on:updateText={forward('updateText')}
					on:delegate={forward('delegate')}
					on:revokeDelegation={forward('revokeDelegation')}
					on:releaseBudget={forward('releaseBudget')}
				/>
			{/each}
		</div>
	{:else}
		<p class="py-8 text-center text-faint">{emptyMessage ?? $_('todo.list.empty')}</p>
	{/if}
</div>
