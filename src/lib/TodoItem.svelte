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
	/** @param {string} did */
	function formatDid(did) {
		return did.length > 24 ? `${did.slice(0, 14)}…${did.slice(-6)}` : did;
	}
</script>

<script>
	import { createEventDispatcher } from 'svelte';
	import { formatPeerId } from './utils.js';
	import { delegationStatus, isDelegationActiveFor } from './delegation.js';

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
	// delegation01
	/** @type {string | null} */
	export let createdByIdentity = null;
	/** @type {import('./delegation.js').Delegation | null} */
	export let delegation = null;
	/** @type {string | undefined} */
	export let updatedBy = undefined;
	/** The identity this session writes with; decides owner / delegate / neither. */
	/** @type {string | null} */
	export let currentIdentityId = null;
	/** Whether the active list's controller accepts delegation at all. */
	export let delegationEnabled = false;

	let showReplicationTooltip = false;
	let isEditing = false;
	let editText = '';
	let isDelegating = false;
	let delegateDid = '';
	let delegationExpiresAt = '';

	const dispatch = createEventDispatcher();

	// A todo from before this chapter has no owner identity and keeps acl01's
	// rule: anyone with write access may change it.
	$: isLegacy = !createdByIdentity;
	$: isOwner = isLegacy || (Boolean(currentIdentityId) && currentIdentityId === createdByIdentity);
	$: isDelegate = !isOwner && isDelegationActiveFor({ delegation }, currentIdentityId);
	$: canChange = isOwner || isDelegate;
	$: status = delegationStatus(delegation);
	$: canDelegate = delegationEnabled && isOwner && !isLegacy;
	$: canRevoke = isOwner && status === 'active';
	/** @type {'owner' | 'delegate' | 'none'} */
	$: role = isOwner ? 'owner' : isDelegate ? 'delegate' : 'none';

	function handleToggleComplete() {
		dispatch('toggleComplete', { key: todoKey });
	}

	function handleDelete() {
		dispatch('delete', { key: todoKey });
	}

	function startEdit() {
		editText = text;
		isEditing = true;
	}

	function saveEdit() {
		const next = editText.trim();
		isEditing = false;
		if (!next || next === text) return;
		dispatch('updateText', { key: todoKey, text: next });
	}

	function startDelegate() {
		delegateDid =
			status === 'active' || status === 'expired' ? (delegation?.delegateDid ?? '') : '';
		delegationExpiresAt = '';
		isDelegating = true;
	}

	function saveDelegate() {
		const did = delegateDid.trim();
		if (!did) return;
		isDelegating = false;
		dispatch('delegate', {
			key: todoKey,
			delegateDid: did,
			expiresAt: delegationExpiresAt ? new Date(delegationExpiresAt).toISOString() : null
		});
	}

	function handleRevoke() {
		dispatch('revokeDelegation', { key: todoKey });
	}

	/** @param {KeyboardEvent} event @param {() => void} save @param {() => void} cancel */
	function onEditKey(event, save, cancel) {
		if (event.key === 'Enter') save();
		if (event.key === 'Escape') cancel();
	}
</script>

<div
	class="rounded-md border border-border p-3 hover:bg-surface"
	data-testid="todo-item"
	data-todo-key={todoKey}
	data-todo-text={text}
	data-role={role}
	data-delegation-status={status}
>
	<div class="flex items-center justify-between">
		<div class="flex flex-1 items-center space-x-3">
			<button
				type="button"
				class:animate-pulse={replicationStatus === 'pending'}
				class:bg-cyan-500={replicationStatus === 'pending'}
				class:bg-identity-500={replicationStatus === 'pinned'}
				class:bg-data-400={replicationStatus === 'unavailable'}
				class:bg-surface-2={replicationStatus === 'unknown'}
				class="relative inline-flex h-2 w-2 shrink-0 cursor-help rounded-full p-0 shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
				aria-label={getReplicationDescription(replicationStatus)}
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
						<span class="font-semibold">Relay replication:</span>
						{getReplicationDescription(replicationStatus)}
					</span>
				{/if}
			</button>
			<input
				type="checkbox"
				checked={completed}
				disabled={!canChange}
				title={canChange
					? 'Toggle completion'
					: 'Only the owner or the delegate of this todo can complete it'}
				on:change={handleToggleComplete}
				class="h-4 w-4 rounded text-cyan-600 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
				data-testid="todo-complete-checkbox"
			/>
			<div class="flex-1">
				{#if isEditing}
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={editText}
							class="min-w-0 flex-1 rounded-md border border-border px-2 py-1 text-sm"
							data-testid="todo-edit-input"
							on:keydown={(event) => onEditKey(event, saveEdit, () => (isEditing = false))}
						/>
						<button
							type="button"
							on:click={saveEdit}
							class="rounded-md bg-cyan-600 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-700"
							data-testid="todo-edit-save">Save</button
						>
						<button
							type="button"
							on:click={() => (isEditing = false)}
							class="rounded-md px-2 py-1 text-xs text-faint hover:text-heading">Cancel</button
						>
					</div>
				{:else}
					<span
						class={completed ? 'text-faint line-through' : 'text-heading'}
						data-testid="todo-text"
						data-todo-text={text}
					>
						{text}
					</span>
				{/if}
				<div class="mt-1 text-sm text-faint">
					{#if assignee}
						Assigned to: <code class="rounded bg-surface-2 px-1">{formatPeerId(assignee)}</code>
					{:else}
						<span class="text-data-600">Unassigned</span>
					{/if}
					• Created by:
					<code
						class="rounded bg-surface-2 px-1"
						data-testid="todo-author"
						data-author={author || ''}>{author ? formatDid(author) : formatPeerId(createdBy)}</code
					>
					{#if status !== 'none' && delegation}
						• Delegated to:
						<code
							class="rounded bg-surface-2 px-1"
							title={delegation.delegateDid}
							data-testid="todo-delegate"
							data-did={delegation.delegateDid}>{formatDid(delegation.delegateDid)}</code
						>
						{#if delegation.expiresAt}
							<span title={new Date(delegation.expiresAt).toISOString()}
								>(until {new Date(delegation.expiresAt).toLocaleString()})</span
							>
						{/if}
						<span
							class={status === 'active'
								? 'text-emerald-600'
								: status === 'revoked'
									? 'text-danger-500'
									: 'text-data-600'}
							data-testid="todo-delegation-status">{status}</span
						>
					{/if}
					{#if updatedBy && updatedBy !== createdByIdentity}
						• Last changed by delegate:
						<code class="rounded bg-surface-2 px-1" title={updatedBy} data-testid="todo-updated-by"
							>{formatDid(updatedBy)}</code
						>
					{/if}
				</div>
			</div>
		</div>
		<div class="flex flex-wrap justify-end gap-1">
			{#if canChange && !isEditing}
				<button
					type="button"
					on:click={startEdit}
					class="rounded-md px-2 py-1 text-xs text-faint transition-colors hover:text-heading"
					data-testid="todo-edit">Rename</button
				>
			{/if}
			{#if canDelegate && !isDelegating}
				<button
					type="button"
					on:click={startDelegate}
					class="rounded-md px-2 py-1 text-xs text-cyan-700 transition-colors hover:text-cyan-900"
					data-testid="todo-delegate-open">{status === 'none' ? 'Delegate' : 'Re-delegate'}</button
				>
			{/if}
			{#if canRevoke}
				<button
					type="button"
					on:click={handleRevoke}
					class="rounded-md px-2 py-1 text-xs text-data-600 transition-colors hover:text-data-700"
					data-testid="todo-revoke-delegation">Revoke</button
				>
			{/if}
			{#if isOwner}
				<button
					on:click={handleDelete}
					class="rounded-md px-3 py-1 text-danger-500 transition-colors hover:text-danger-700"
				>
					Delete
				</button>
			{/if}
		</div>
	</div>

	{#if isDelegating}
		<div
			class="mt-3 grid grid-cols-1 gap-2 rounded-md border border-border bg-surface-2 p-3 sm:grid-cols-[1fr_auto_auto_auto]"
			data-testid="todo-delegate-form"
		>
			<input
				type="text"
				bind:value={delegateDid}
				placeholder="did:key:… of the delegate"
				class="min-w-0 rounded-md border border-border px-2 py-1 font-mono text-xs"
				data-testid="todo-delegate-did-input"
				on:keydown={(event) => onEditKey(event, saveDelegate, () => (isDelegating = false))}
			/>
			<input
				type="datetime-local"
				bind:value={delegationExpiresAt}
				title="Expires at (optional)"
				class="rounded-md border border-border px-2 py-1 text-xs"
				data-testid="todo-delegate-expiry-input"
			/>
			<button
				type="button"
				on:click={saveDelegate}
				disabled={!delegateDid.trim()}
				class="rounded-md bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
				data-testid="todo-delegate-save">Delegate</button
			>
			<button
				type="button"
				on:click={() => (isDelegating = false)}
				class="rounded-md px-2 py-1 text-xs text-faint hover:text-heading">Cancel</button
			>
		</div>
	{/if}
</div>
