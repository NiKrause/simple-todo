<script>
	/**
	 * Where this browser keeps the todos it holds.
	 *
	 * Its own component in the consent dialog's slot, next to the mnemonic and
	 * the identity choice, because it is this app's decision rather than the
	 * dialog's — and because it has to be made *before* Helia and OrbitDB are
	 * built. Changing it afterwards would mean tearing the node down.
	 *
	 * Ported from `main`, where the same choice has been in the consent screen
	 * since the storage mode existed. This chapter has been in-memory only and
	 * never said so, which is why a reload silently emptied everything.
	 */
	import { _ } from '$lib/i18n/index.js';
	import { getPersistentStorageEnabled, setPersistentStorageEnabled } from './storage-mode.js';

	/**
	 * Exposed so the consent statement can name the consequence of the option
	 * actually selected, rather than describing both and leaving the reader to
	 * work out which one applies to them.
	 *
	 * @type {'memory' | 'indexeddb'}
	 */
	export let mode = getPersistentStorageEnabled() ? 'indexeddb' : 'memory';

	let persistent = mode === 'indexeddb';

	$: setPersistentStorageEnabled(persistent);
	$: mode = persistent ? 'indexeddb' : 'memory';
</script>

<fieldset class="mb-4 rounded-md border border-border p-3" data-testid="storage-mode">
	<legend class="px-1 text-xs font-medium text-heading">{$_('consent.storageLegend')}</legend>

	<label class="flex cursor-pointer items-start gap-2 text-sm">
		<input
			type="radio"
			bind:group={persistent}
			value={false}
			data-testid="storage-mode-memory"
			class="mt-1"
		/>
		<span>
			<span class="text-text">{$_('consent.storageMemoryLabel')}</span>
			<span class="mt-0.5 block text-xs text-faint">
				{$_('consent.storageMemoryHint')}
			</span>
		</span>
	</label>

	<label class="mt-2 flex cursor-pointer items-start gap-2 text-sm">
		<input
			type="radio"
			bind:group={persistent}
			value={true}
			data-testid="storage-mode-indexeddb"
			class="mt-1"
		/>
		<span>
			<span class="text-text">{$_('consent.storagePersistentLabel')}</span>
			<span class="mt-0.5 block text-xs text-faint">
				{$_('consent.storagePersistentHint')}
			</span>
		</span>
	</label>
</fieldset>
