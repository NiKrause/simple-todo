<script context="module">
	// Returns a translation *key*, not a sentence. This lives in
	// `<script module>`, where a store cannot be read at all — and even if it
	// could, a function that bakes in the current language would hand back a
	// German string to an English page after a switch. The caller translates,
	// where the subscription exists and re-runs.
	/** @param {'unknown' | 'pending' | 'pinned' | 'unavailable'} status */
	export function getReplicationDescriptionKey(status) {
		if (status === 'pending') return 'todo.relayPending';
		if (status === 'pinned') return 'todo.relayPinned';
		if (status === 'unavailable') return 'todo.relayUnknown';
		return 'todo.relayNotObserved';
	}
	/** @param {string} did */
	function formatDid(did) {
		return did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did;
	}
</script>

<script>
	import { _ } from '$lib/i18n/index.js';
	import { createEventDispatcher } from 'svelte';
	import { formatPeerId } from './utils.js';

	export const id = undefined;
	export let text = '';
	export let completed = false;
	/** @type {string | null} */
	export let assignee = null;
	export let createdBy = '';
	export let author = '';
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
			aria-label={$_(getReplicationDescriptionKey(replicationStatus))}
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
					<span class="font-semibold">{$_('todo.relayStatus')}</span>
					{$_(getReplicationDescriptionKey(replicationStatus))}
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
					Assigned to: <code class="rounded bg-surface-2 px-1">{formatPeerId(assignee)}</code>
				{:else}
					<span class="text-data-600">{$_('todo.unassigned')}</span>
				{/if}
				• Created by:
				<code class="rounded bg-surface-2 px-1" data-testid="todo-author" data-author={author || ''}
					>{author ? formatDid(author) : formatPeerId(createdBy)}</code
				>
			</div>
		</div>
	</div>
	<div class="flex space-x-2">
		<button
			on:click={handleDelete}
			class="rounded-md px-3 py-1 text-danger-500 transition-colors hover:text-danger-700"
		>
			Delete
		</button>
	</div>
</div>
