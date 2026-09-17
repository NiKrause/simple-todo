<script>
	// The open list, above its todos (escrow01): which list the todos below
	// belong to, and the way to another one. The details of the list, its
	// address and who may write to it, are in the lists tab.
	import { _ } from '$lib/i18n/index.js';
	import { activeListStore } from './db-actions.js';
	import { shortId } from './utils.js';

	/** The shared list has no name of its own; its three words are its name. */
	export let mnemonic = '';

	const KINDS = ['shared', 'private', 'guest'];
	$: list = $activeListStore;
	$: kind = KINDS.includes(list?.kind) ? list.kind : 'shared';
	$: name = kind === 'shared' ? mnemonic : list.name || shortId(list.address);
</script>

<div
	class="mb-4 flex items-end justify-between gap-3"
	data-testid="active-list-heading"
	data-kind={kind}
>
	<div class="min-w-0">
		<p class="text-xs font-medium text-faint">{$_(`lists.active.${kind}`)}</p>
		<h2 class="truncate text-2xl font-bold" data-testid="active-list-name">
			{name || $_('lists.switcher.unnamed')}
		</h2>
	</div>
	<a
		href="#listen"
		data-testid="switch-list"
		class="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-cyan-800 no-underline outline-none hover:underline focus-visible:ring-2 focus-visible:ring-cyan-500 dark:text-cyan"
	>
		{$_('sections.list.switch')}
		<svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
			<path
				fill-rule="evenodd"
				d="M7.2 4.7a1 1 0 011.4 0l4.6 4.6a1 1 0 010 1.4l-4.6 4.6a1 1 0 11-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 010-1.4z"
				clip-rule="evenodd"
			/>
		</svg>
	</a>
</div>
