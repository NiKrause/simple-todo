<script context="module">
	/** @param {'unknown' | 'pending' | 'pinned' | 'unavailable'} status */
	export function getReplicationDescription(status) {
		if (status === 'pending')
			return 'Waiting for this OrbitDB entry to be replicated by the relay.';
		if (status === 'pinned')
			return 'The relay confirmed that this exact OrbitDB entry was replicated and stored locally.';
		if (status === 'unavailable')
			return 'No exact relay replication proof is currently available for this entry.';
		return 'Relay replication status was not observed for this existing entry.';
	}
</script>

<script>
	import { createEventDispatcher } from 'svelte';
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

	const dispatch = createEventDispatcher();

	function handleToggleComplete() {
		dispatch('toggleComplete', { key: todoKey });
	}

	function handleDelete() {
		dispatch('delete', { key: todoKey });
	}
</script>

<div
	class="flex items-center justify-between rounded-md border border-gray-200 p-3 hover:bg-gray-50"
>
	<div class="flex flex-1 items-center space-x-3">
		<span
			class:animate-pulse={replicationStatus === 'pending'}
			class:bg-blue-500={replicationStatus === 'pending'}
			class:bg-green-500={replicationStatus === 'pinned'}
			class:bg-amber-400={replicationStatus === 'unavailable'}
			class:bg-gray-300={replicationStatus === 'unknown'}
			class="h-2 w-2 shrink-0 cursor-help rounded-full shadow-sm"
			role="img"
			aria-label={getReplicationDescription(replicationStatus)}
			title={getReplicationDescription(replicationStatus)}
			data-testid="todo-relay-status"
			data-status={replicationStatus}
		></span>
		<input
			type="checkbox"
			checked={completed}
			on:change={handleToggleComplete}
			class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
		/>
		<div class="flex-1">
			<span class={completed ? 'text-gray-500 line-through' : 'text-gray-800'}>
				{text}
			</span>
			<div class="mt-1 text-sm text-gray-500">
				{#if assignee}
					Assigned to: <code class="rounded bg-gray-100 px-1">{formatPeerId(assignee)}</code>
				{:else}
					<span class="text-orange-600">Unassigned</span>
				{/if}
				• Created by: <code class="rounded bg-gray-100 px-1">{formatPeerId(createdBy)}</code>
			</div>
		</div>
	</div>
	<div class="flex space-x-2">
		<button
			on:click={handleDelete}
			class="rounded-md px-3 py-1 text-red-500 transition-colors hover:text-red-700"
		>
			Delete
		</button>
	</div>
</div>
