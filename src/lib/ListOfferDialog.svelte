<script>
	// Somebody just handed you a list. Yes or no.
	//
	// The address arriving is not consent to open it: replicating a database
	// means pulling somebody else's data onto this device and announcing
	// interest in it on the network. So the envelope only ever sets state, and
	// this is where a person decides — which is also the only moment the owner's
	// DID is worth showing, because it is what "who is this from" means here.
	import { incomingListOffer, declineListOffer } from './handover-protocol.js';
	import { loadTodoDatabase, orbitdbStore } from './db-actions.js';
	import { rememberList } from './list-registry.js';

	let busy = false;
	/** @type {string | null} */
	let error = null;

	async function accept() {
		const offer = $incomingListOffer;
		if (!offer) return;
		busy = true;
		error = null;
		try {
			await loadTodoDatabase(offer.address);
			// 'guest', not 'owner': acl01's registry already distinguishes the two,
			// and this list is one we hold rather than one we can write to.
			// Best effort — a registry that fails must not lose the list that was
			// just opened.
			try {
				await rememberList($orbitdbStore, {
					address: offer.address,
					name: offer.name,
					role: 'guest'
				});
			} catch (registryError) {
				console.warn('Could not record the received list in the registry:', registryError);
			}
			declineListOffer();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}
</script>

{#if $incomingListOffer}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
		data-testid="list-offer-dialog"
	>
		<div class="w-full max-w-md rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900">
			<h2 class="text-base font-semibold text-heading">A list was sent to you</h2>
			<p class="mt-2 text-sm text-faint">
				<strong data-testid="list-offer-name">{$incomingListOffer.name || 'Unnamed list'}</strong>
			</p>
			<p class="mt-1 text-xs break-all text-faint" data-testid="list-offer-owner">
				from {$incomingListOffer.ownerDid}
			</p>
			<p class="mt-1 text-xs break-all text-faint" data-testid="list-offer-address">
				{$incomingListOffer.address}
			</p>
			<p class="mt-3 text-xs text-faint">
				Accepting replicates it onto this device. You can read it; only its owner can write to it.
			</p>

			{#if error}
				<p class="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="list-offer-error">
					{error}
				</p>
			{/if}

			<div class="mt-4 flex justify-end gap-2">
				<button
					type="button"
					class="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
					disabled={busy}
					on:click={declineListOffer}
					data-testid="list-offer-decline">No</button
				>
				<button
					type="button"
					class="rounded bg-cyan-600 px-3 py-1 text-xs text-white hover:bg-cyan-700 disabled:opacity-50"
					disabled={busy}
					on:click={accept}
					data-testid="list-offer-accept">{busy ? 'Replicating…' : 'Yes, import it'}</button
				>
			</div>
		</div>
	</div>
{/if}
