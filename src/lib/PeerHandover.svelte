<script>
	// Handing a list to somebody who is already connected.
	//
	// The QR path needs the other phone in front of you. Once a relay is in play
	// the other device can be anywhere, and then there is no code to hold up -
	// only a list of who is reachable and the question which of them this is for.
	//
	// The two halves that make that usable live elsewhere on purpose:
	// `createPeerRoster` keeps the list still enough to click, and `sendListOffer`
	// dials the node rather than the QR session, so a peer met through a relay can
	// be reached at all.
	import { onDestroy, onMount } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { createPeerRoster } from './peer-roster.js';
	import { sendListOffer } from './handover-protocol.js';
	import { libp2pStore, ownDidStore } from './p2p.js';
	import { todoDBAddressStore, activeListStore } from './db-actions.js';
	import ManualConnectForm from './ManualConnectForm.svelte';
	import { relayOptIn } from './relay-availability.js';

	const roster = createPeerRoster();

	/** @type {Array<{peerId: string, since: number, state: string, transports: string[]}>} */
	let peers = [];
	/** @type {string | null} */
	let sending = null;
	/** @type {string | null} */
	let sentTo = null;
	/** @type {string | null} */
	let error = null;

	/** @type {(() => void) | null} */
	let detach = null;

	// Mounted on demand, not with the panel. This tab is hidden rather than
	// unmounted, so anything rendered here is rendered for every visitor on every
	// load - and `ManualConnectForm` carries relay probing and Aleph discovery
	// with it. Mounting it unasked measurably disturbed the handover: with it
	// present the remote scenario could no longer accept an offer, and could
	// again the moment it was gone. Behind a click it is the same form and
	// nobody's problem.
	let connectOpen = false;

	// Re-attached whenever the node is replaced, which happens on every identity
	// change. Holding the old node's listeners would show a list of peers that
	// belong to a node nobody is talking through any more.
	$: if ($libp2pStore) {
		detach?.();
		detach = roster.observe($libp2pStore);
	}

	onMount(() => roster.onChange((list) => (peers = list)));

	onDestroy(() => {
		detach?.();
		roster.stop();
	});

	/** @param {string} peerId */
	async function offerTo(peerId) {
		const address = $todoDBAddressStore;
		if (!address) {
			error = $_('handover.noList');
			return;
		}

		sending = peerId;
		error = null;
		sentTo = null;

		try {
			await sendListOffer($libp2pStore, peerId, {
				address,
				name: $activeListStore?.name ?? '',
				ownerDid: $ownDidStore ?? ''
			});
			sentTo = peerId;
		} catch (err) {
			error = $_('handover.failed', {
				values: { reason: err instanceof Error ? err.message : String(err) }
			});
		} finally {
			sending = null;
		}
	}

	/** Enough to tell two peers apart without filling the row with base58. */
	const short = (/** @type {string} */ peerId) => `${peerId.slice(0, 8)}…${peerId.slice(-6)}`;
</script>

<section class="mt-6 border-t border-border pt-4" data-testid="peer-handover">
	<h3 class="text-sm font-medium text-heading">
		{$relayOptIn ? $_('handover.headingOnly') : $_('handover.heading')}
	</h3>
	<p class="mt-1 text-xs text-faint">{$_('handover.hint')}</p>

	{#if peers.length === 0}
		<p class="mt-3 text-xs text-faint" data-testid="peer-handover-empty">{$_('handover.empty')}</p>
	{:else}
		<ul class="mt-3 space-y-2" data-testid="peer-handover-list">
			{#each peers as peer (peer.peerId)}
				<li
					class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2"
					data-testid="peer-handover-row"
					data-peer={peer.peerId}
					data-state={peer.state}
				>
					<div class="min-w-0">
						<span class="font-mono text-xs text-text">{short(peer.peerId)}</span>
						<span class="ml-2 text-xs text-faint">{$_(`handover.state.${peer.state}`)}</span>
						{#each peer.transports as transport (transport)}
							<span class="ml-1 rounded bg-surface px-1 text-[10px] text-faint">{transport}</span>
						{/each}
					</div>
					<button
						type="button"
						class="rounded-md bg-cyan-600 px-3 py-1 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
						disabled={sending !== null}
						data-testid="peer-handover-send"
						on:click={() => offerTo(peer.peerId)}
					>
						{sending === peer.peerId ? $_('handover.sending') : $_('handover.send')}
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if sentTo}
		<p class="mt-2 text-xs text-emerald-700 dark:text-emerald-400" data-testid="peer-handover-sent">
			{$_('handover.sent', { values: { peer: short(sentTo) } })}
		</p>
	{/if}
	{#if error}
		<p class="mt-2 text-xs text-red-700 dark:text-red-400" data-testid="peer-handover-error">
			{error}
		</p>
	{/if}

	<div class="mt-3">
		<button
			type="button"
			class="text-xs text-faint underline"
			data-testid="peer-handover-connect-toggle"
			on:click={() => (connectOpen = !connectOpen)}
		>
			{$_('handover.connectManually')}
		</button>
		{#if connectOpen}
			<div class="mt-2">
				<ManualConnectForm compact />
			</div>
		{/if}
	</div>
</section>
