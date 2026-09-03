<script context="module">
	/**
	 * The message key for a replication state, not the sentence.
	 *
	 * It returned English prose until the app learned a second language. A
	 * module-level function cannot read `$_` — that is a store subscription and
	 * belongs to a component instance — so it names the string and the caller
	 * resolves it. The name stays: `getReplicationDescription` is imported by a
	 * test, and what it describes has not changed.
	 *
	 * @param {'unknown' | 'pending' | 'pinned' | 'unavailable'} status
	 */
	export function getReplicationDescription(status) {
		if (status === 'pending') return 'todo.replication.pending';
		if (status === 'pinned') return 'todo.replication.pinned';
		if (status === 'unavailable') return 'todo.replication.unavailable';
		return 'todo.replication.unknown';
	}
</script>

<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { formatPeerId } from './utils.js';

	export const id = undefined;
	export let text = '';
	export let completed = false;
	/** @type {string | null} */
	export let assignee = null;
	export let createdBy = '';
	export let todoKey = '';
	/** @type {'unknown' | 'pending' | 'pinned' | 'unavailable'} */
	export let replicationStatus = 'unknown';
	let showReplicationTooltip = false;

	const dispatch = createEventDispatcher();

	function handleToggleComplete() {
		dispatch('toggleComplete', { key: todoKey });
	}

	function handleDelete() {
		dispatch('delete', { key: todoKey });
	}
</script>

<div
	class="flex items-center justify-between rounded-md border border-border p-3 hover:bg-surface"
	data-testid="todo-item"
>
	<div class="flex flex-1 items-center space-x-3">
		<button
			type="button"
			class:animate-pulse={replicationStatus === 'pending'}
			class:bg-cyan-500={replicationStatus === 'pending'}
			class:bg-identity-500={replicationStatus === 'pinned'}
			class:bg-data-400={replicationStatus === 'unavailable'}
			class:bg-surface-2={replicationStatus === 'unknown'}
			class="relative inline-flex h-2 w-2 shrink-0 cursor-help rounded-full p-0 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
			aria-label={$_(getReplicationDescription(replicationStatus))}
			data-testid="todo-relay-status"
			data-status={replicationStatus}
			on:mouseenter={() => (showReplicationTooltip = true)}
			on:mouseleave={() => (showReplicationTooltip = false)}
			on:focus={() => (showReplicationTooltip = true)}
			on:blur={() => (showReplicationTooltip = false)}
		>
			{#if showReplicationTooltip}
				<span
					class="pointer-events-none absolute bottom-full left-0 z-30 mb-2 w-max max-w-72 rounded-md bg-code px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
					role="tooltip"
					data-testid="todo-relay-tooltip"
				>
					<span class="font-semibold">{$_('todo.replicationLabel')}</span>
					{$_(getReplicationDescription(replicationStatus))}
				</span>
			{/if}
		</button>
		<input
			type="checkbox"
			checked={completed}
			on:change={handleToggleComplete}
			class="h-4 w-4 rounded text-cyan-600 focus:ring-cyan-500"
		/>
		<div class="flex-1">
			<span class={completed ? 'text-faint line-through' : 'text-heading'}>
				{text}
			</span>
			<div class="mt-1 text-sm text-faint">
				{#if assignee}
					{$_('todo.assignedTo')}
					<code class="rounded bg-surface-2 px-1">{formatPeerId(assignee)}</code>
				{:else}
					<span class="text-data-600">{$_('todo.unassigned')}</span>
				{/if}
				• {$_('todo.createdBy')}
				<code class="rounded bg-surface-2 px-1">{formatPeerId(createdBy)}</code>
			</div>
		</div>
	</div>
	<div class="flex space-x-2">
		<button
			on:click={handleDelete}
			class="rounded-md px-3 py-1 text-danger-500 transition-colors hover:text-danger-700"
		>
			{$_('todo.delete')}
		</button>
	</div>
</div>
