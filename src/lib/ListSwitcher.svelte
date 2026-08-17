<script>
	import { _ } from '$lib/i18n/index.js';
	// The list of lists (acl01, issue #114 step 3). Entries come from the
	// identity's own registry database, so they survive a reload and replicate
	// to the same passkey on another device — see list-registry.js.
	import {
		listRegistryStore,
		listRegistryReadyStore,
		listRegistryNameStore,
		forgetList
	} from './list-registry.js';
	import { orbitdbStore, todoDBAddressStore, loadTodoDatabase, dropList } from './db-actions.js';

	/** @type {string | null} */
	let busyAddress = null;
	/** @type {string | null} */
	let errorMessage = null;

	/** @param {string} address */
	async function open(address) {
		if (address === $todoDBAddressStore) return;
		busyAddress = address;
		errorMessage = null;
		try {
			await loadTodoDatabase(address);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busyAddress = null;
		}
	}

	/**
	 * Stop tracking a list, leaving its data alone.
	 *
	 * @param {string} address
	 */
	async function forget(address) {
		busyAddress = address;
		errorMessage = null;
		try {
			await forgetList($orbitdbStore, address);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busyAddress = null;
		}
	}

	/**
	 * Drop a list from this device — its data and its registry entry.
	 *
	 * This used to only forget the entry, which left the replicated blocks
	 * behind. That was survivable while storage was in memory and a reload
	 * cleared everything anyway; now that blocks live in IndexedDB, a
	 * forget-without-drop leaves data on the device that nothing references and
	 * nothing will ever clean up.
	 *
	 * @param {string} address
	 */
	async function drop(address) {
		busyAddress = address;
		errorMessage = null;
		try {
			await dropList(address);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busyAddress = null;
		}
	}
</script>

{#if $listRegistryReadyStore && $listRegistryStore.length}
	<section
		class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
		data-testid="list-switcher"
		data-registry-name={$listRegistryNameStore}
	>
		<h2 class="text-lg font-semibold text-heading">{$_('lists.heading')}</h2>
		<p class="mt-1 text-xs text-faint">
			{$_('lists.kept')}
		</p>

		<ul class="mt-3 flex flex-col gap-1" data-testid="list-switcher-items">
			{#each $listRegistryStore as entry (entry.address)}
				{@const active = entry.address === $todoDBAddressStore}
				<li class="flex items-center gap-2">
					<button
						type="button"
						on:click={() => open(entry.address)}
						disabled={busyAddress !== null}
						data-testid="list-switcher-open"
						data-address={entry.address}
						data-active={active}
						class="min-w-0 flex-1 rounded-md border px-2 py-1.5 text-left text-xs disabled:opacity-50
							{active
							? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950'
							: 'border-gray-300 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800'}"
					>
						<span class="font-medium text-heading">{entry.name || $_('lists.unnamed')}</span>
						<span class="ml-1 text-faint">· {$_(`lists.role.${entry.role}`)}</span>
						{#if active}<span class="ml-1 text-emerald-700 dark:text-emerald-400"
								>· {$_('lists.active')}</span
							>{/if}
						<code class="mt-0.5 block truncate font-mono text-[10px] text-faint"
							>{entry.address}</code
						>
					</button>
					<!--
						Two different intents, deliberately kept apart.

						Forget stops tracking the list and leaves its data alone, so
						reopening it by address still works — that is what the earlier
						chapters mean by it, and list-registry.spec.js pins it.

						Drop deletes the data from this device as well. It only became
						worth having once blocks moved to IndexedDB: while everything
						lived in memory there was nothing to delete that a reload would
						not clear anyway.
					-->
					<button
						type="button"
						on:click={() => forget(entry.address)}
						disabled={busyAddress !== null}
						title="Remove from this list of lists; the database itself is untouched"
						data-testid="list-switcher-forget"
						data-address={entry.address}
						class="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
					>
						{$_('lists.forget')}
					</button>
					<button
						type="button"
						on:click={() => drop(entry.address)}
						disabled={busyAddress !== null}
						title="Delete this list's data from this device and remove it from the list of lists"
						data-testid="list-switcher-drop"
						data-address={entry.address}
						class="shrink-0 rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
					>
						{$_('lists.drop')}
					</button>
				</li>
			{/each}
		</ul>

		{#if errorMessage}
			<p class="mt-2 text-xs text-red-600" data-testid="list-switcher-error">{errorMessage}</p>
		{/if}
	</section>
{/if}
