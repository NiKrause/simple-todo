<script>
	import { onMount } from 'svelte';
	import { getQrSession, isQrTransportMode } from './qr-transport.js';

	let visible = $state(false);
	let outgoing = $state('');
	let incoming = $state('');
	let status = $state('Create an invite, or paste the one you were given.');
	let busy = $state(false);

	onMount(() => {
		visible = isQrTransportMode();
	});

	function session() {
		const current = getQrSession();

		if (current == null) {
			throw new Error('The peer is still starting');
		}

		return current;
	}

	async function createInvite() {
		busy = true;
		try {
			outgoing = await session().createOffer();
			status = 'Send this invite. Paste their reply below when it comes back.';
		} catch (/** @type {any} */ error) {
			status = `Could not create an invite: ${error.message}`;
		} finally {
			busy = false;
		}
	}

	/**
	 * One box for both directions. Which one a payload is decides itself - an
	 * offer produces a reply, a reply completes the connection - and asking the
	 * user to know which of the two they were handed is asking the wrong person.
	 */
	async function usePayload() {
		const text = incoming.trim();

		if (text.length === 0) {
			return;
		}

		busy = true;
		try {
			if (outgoing.length > 0) {
				// 0.4.0 dials for us. Before that this had to be done by hand, because
				// until something dials there is no libp2p connection at all - and this
				// app has no protocol of its own to open, OrbitDB and gossipsub simply
				// use whatever connection exists.
				const { peerId } = await session().acceptAnswer(text);

				status = `Connected to ${peerId.slice(0, 12)}…`;
			} else {
				outgoing = await session().acceptOffer(text);
				status = 'Send this reply back to them.';
			}
			incoming = '';
		} catch (/** @type {any} */ error) {
			status = `That payload was rejected: ${error.message}`;
		} finally {
			busy = false;
		}
	}
</script>

{#if visible}
	<section
		class="mb-4 rounded-lg border border-amber-400/40 bg-amber-50 p-4 dark:bg-gray-800"
		data-testid="qr-connect"
	>
		<h2 class="mb-1 text-sm font-semibold">Connect by invite</h2>
		<p class="mb-3 text-xs text-gray-600 dark:text-gray-300">
			No relay, no discovery. This peer meets others only through an invite you exchange yourself.
		</p>

		<div class="flex flex-wrap gap-2">
			<button
				class="rounded bg-amber-500 px-3 py-1 text-sm text-white disabled:opacity-50"
				onclick={createInvite}
				disabled={busy}
				data-testid="qr-create-invite">Create invite</button
			>
		</div>

		<textarea
			class="mt-3 w-full rounded border p-2 font-mono text-xs dark:bg-gray-900"
			rows="2"
			readonly
			data-testid="qr-outgoing"
			value={outgoing}
		></textarea>

		<textarea
			class="mt-2 w-full rounded border p-2 font-mono text-xs dark:bg-gray-900"
			rows="2"
			placeholder="Paste their invite or reply here"
			data-testid="qr-incoming"
			bind:value={incoming}
		></textarea>

		<button
			class="mt-2 rounded border px-3 py-1 text-sm disabled:opacity-50"
			onclick={usePayload}
			disabled={busy}
			data-testid="qr-use-payload">Use this</button
		>

		<p class="mt-2 text-xs" data-testid="qr-status">{status}</p>
	</section>
{/if}
