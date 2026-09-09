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
	import { getPersistentStorageEnabled, setPersistentStorageEnabled } from './storage-mode.js';

	let persistent = getPersistentStorageEnabled();

	$: setPersistentStorageEnabled(persistent);
</script>

<fieldset class="mb-4 rounded-md border border-border p-3" data-testid="storage-mode">
	<legend class="px-1 text-xs font-medium text-heading">Where your todos are stored</legend>

	<label class="flex cursor-pointer items-start gap-2 text-sm">
		<input
			type="radio"
			bind:group={persistent}
			value={false}
			data-testid="storage-mode-memory"
			class="mt-1"
		/>
		<span>
			<span class="text-text">In memory only</span>
			<span class="mt-0.5 block text-xs text-faint">
				Nothing is written to this device. Reload the page and this browser starts over — the lists
				come back only from another device or the relay.
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
			<span class="text-text">Keep them in this browser</span>
			<span class="mt-0.5 block text-xs text-faint">
				Todos are stored in the browser's IndexedDB and survive a restart. They are not encrypted
				there, so anyone who can read this browser's storage can read them.
			</span>
		</span>
	</label>
</fieldset>
