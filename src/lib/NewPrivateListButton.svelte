<script>
	import { _ } from '$lib/i18n/index.js';
	// Create a new access-controlled private list (acl01). The public mnemonic
	// list stays available; this opens a fresh owner-only list and switches to
	// it, after which the permissions panel appears for granting DIDs.
	import { createPrivateTodoList } from './db-actions.js';
	import { createSiteList, SITE_TODOS } from './site-list.js';

	let name = '';
	let busy = false;
	/** @type {string | null} */
	let errorMessage = null;
	/** @type {{ name: string, address: string } | null} */
	let created = null;
	let copied = false;

	async function create() {
		busy = true;
		errorMessage = null;
		created = null;
		try {
			// Keep the result. Dropping it is what made a created list invisible:
			// the box promises "share its address" and then never showed one (#114).
			created = await createPrivateTodoList(name);
			name = '';
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	async function seedSite() {
		busy = true;
		errorMessage = null;
		created = null;
		try {
			const result = await createSiteList();
			created = result;
			// Say what actually landed rather than claiming ten: `addTodo` reports
			// failure by return value, and a partly-filled list is worth noticing
			// before it is handed to somebody.
			if (result.count < SITE_TODOS.length) {
				errorMessage = `Created the list, but only ${result.count} of ${SITE_TODOS.length} items were added.`;
			}
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			busy = false;
		}
	}

	async function copyAddress() {
		if (!created?.address) return;
		await navigator.clipboard.writeText(created.address);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<section
	class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="new-private-list"
>
	<h2 class="text-lg font-semibold text-heading">{$_('list.createHeading')}</h2>
	<p class="mt-1 text-xs text-faint">
		{$_('list.onlyYouCanWrite')}
	</p>
	<div class="mt-3 flex gap-2">
		<input
			type="text"
			bind:value={name}
			placeholder={$_('list.namePlaceholder')}
			data-testid="new-list-name"
			class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs"
		/>
		<button
			type="button"
			on:click={create}
			disabled={busy}
			data-testid="new-list-create"
			class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
		>
			{busy ? $_('list.creating') : $_('list.create')}
		</button>
	</div>

	<!--
		The chapter's worked example, in one tap.

		Alice prepares this list in the office; reaching the part being taught
		should not require typing ten lines on a phone at a building site.
	-->
	<div class="mt-2">
		<button
			type="button"
			on:click={seedSite}
			disabled={busy}
			data-testid="new-list-seed-site"
			class="text-xs font-medium text-cyan-700 underline disabled:opacity-50 dark:text-cyan-400"
		>
			{busy ? 'Working…' : $_('list.example')}
		</button>
	</div>
	{#if errorMessage}
		<p class="mt-2 text-xs text-red-600" data-testid="new-list-error">{errorMessage}</p>
	{/if}

	{#if created}
		<div
			class="mt-3 rounded-md border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950"
			data-testid="new-list-created"
		>
			<p class="text-xs text-heading">
				<!-- Split rather than `{@html}` with the name interpolated: the name is
				     whatever the user typed, and putting that through `@html` would
				     execute a list called `<script>…`. Svelte escapes it here. -->
				{$_('lists.createdBefore')}<strong data-testid="new-list-created-name"
					>{created.name}</strong
				>{$_('lists.createdAfter')}
			</p>
			<p class="mt-2 text-xs text-faint">
				{$_('lists.shareAddress')}
			</p>
			<div class="mt-1 flex items-center gap-2">
				<code
					class="min-w-0 flex-1 font-mono text-xs break-all"
					data-testid="new-list-created-address">{created.address}</code
				>
				<button
					type="button"
					on:click={copyAddress}
					data-testid="new-list-copy-address"
					class="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
				>
					{copied ? $_('transfer.copied') : $_('transfer.copy')}
				</button>
			</div>
		</div>
	{/if}
</section>
