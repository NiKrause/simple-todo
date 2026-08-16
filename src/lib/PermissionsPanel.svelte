<script>
	import { _ } from '$lib/i18n/index.js';
	// Write-permission management for the active todo list (acl01 chapter).
	// Backed by OrbitDBAccessController: grants/revokes mutate the controller's
	// own replicated keyvalue store, so the DB address never changes and peers
	// pick up permission changes live.
	import { onDestroy } from 'svelte';
	import { todoDBStore } from './db-actions.js';
	import { ownDidStore } from './p2p.js';

	/** @type {string[]} */
	let writeDids = [];
	let newDid = '';
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {any} */
	let currentDb = null;
	/** @type {(() => void) | null} */
	let detachUpdateListener = null;

	const unsubscribe = todoDBStore.subscribe((db) => {
		if (db === currentDb) return;
		detachUpdateListener?.();
		currentDb = db;
		writeDids = [];
		errorMessage = null;
		if (!db) return;

		void refresh();
		// The controller's backing store replicates like any OrbitDB database —
		// refresh the list whenever it changes (e.g. the owner granted us).
		const accessEvents = db.access?.events;
		if (accessEvents?.on) {
			const onUpdate = () => void refresh();
			accessEvents.on('update', onUpdate);
			detachUpdateListener = () => accessEvents.off?.('update', onUpdate);
		}
	});

	onDestroy(() => {
		unsubscribe();
		detachUpdateListener?.();
	});

	async function refresh() {
		const db = currentDb;
		if (!db?.access?.capabilities) {
			writeDids = [];
			return;
		}
		try {
			const capabilities = await db.access.capabilities();
			writeDids = Array.from(capabilities.write ?? []).sort();
		} catch (error) {
			console.warn('Could not read access capabilities:', error);
		}
	}

	async function grant() {
		const did = newDid.trim();
		if (!did) return;
		busy = true;
		errorMessage = null;
		try {
			await currentDb.access.grant('write', did);
			newDid = '';
			await refresh();
		} catch (error) {
			errorMessage = `Grant failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			busy = false;
		}
	}

	/** @param {string} did */
	async function revoke(did) {
		busy = true;
		errorMessage = null;
		try {
			await currentDb.access.revoke('write', did);
			await refresh();
		} catch (error) {
			errorMessage = `Revoke failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			busy = false;
		}
	}
</script>

{#if currentDb?.access?.grant}
	<section
		class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
		data-testid="permissions-panel"
	>
		<h2 class="text-lg font-semibold text-heading">{$_('tech.writePermissions')}</h2>
		<p class="mt-1 text-xs text-faint">
			DIDs allowed to write to this list. Only list admins (the creator) can grant or revoke.
		</p>

		<ul class="mt-3 space-y-1">
			{#each writeDids as did (did)}
				<li
					class="flex items-center justify-between gap-2 text-xs"
					data-testid="permission-entry"
					data-did={did}
				>
					<code class="truncate rounded bg-surface-2 px-1" title={did}>
						{did.length > 30 ? `${did.slice(0, 18)}…${did.slice(-8)}` : did}
						{#if did === $ownDidStore}<span class="text-emerald-600"> (you)</span>{/if}
					</code>
					<button
						type="button"
						on:click={() => revoke(did)}
						disabled={busy}
						class="rounded border border-red-300 px-1.5 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
						data-testid="permission-revoke"
					>
						Remove
					</button>
				</li>
			{/each}
		</ul>

		<div class="mt-3 flex gap-2">
			<input
				type="text"
				bind:value={newDid}
				placeholder={$_('tech.didPlaceholder')}
				data-testid="permission-did-input"
				class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 font-mono text-xs"
			/>
			<button
				type="button"
				on:click={grant}
				disabled={busy || !newDid.trim()}
				data-testid="permission-add"
				class="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
			>
				Add DID
			</button>
		</div>

		{#if errorMessage}
			<p class="mt-2 text-xs text-red-600" data-testid="permission-error">{errorMessage}</p>
		{/if}
	</section>
{/if}
