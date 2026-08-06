<script>
	import { onMount } from 'svelte';
	import { getQrSession, isQrTransportMode } from './qr-transport.js';

	// Mounted on every page now, not just under `?transport=qr`: the invite is a
	// second way to meet a peer, next to the relay. What that flag still decides
	// is whether the panel starts open — QR-only mode has no other way to connect,
	// and its E2E expects the controls without a click.
	let mounted = $state(false);
	let open = $state(false);
	let outgoing = $state('');
	let incoming = $state('');
	let status = $state('Create an invite, or scan the code they are showing you.');
	let busy = $state(false);
	/** @type {any} */
	let scanner = $state(null);

	onMount(async () => {
		open = isQrTransportMode();

		// Loaded in the browser only: SvelteKit renders this page on the server
		// first, where `customElements` does not exist.
		await import('@le-space/libp2p-webrtc-qr/elements');
		mounted = true;
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
			status = 'Show this code, or send the text. Then scan their reply.';
		} catch (/** @type {any} */ error) {
			status = `Could not create an invite: ${error.message}`;
		} finally {
			busy = false;
		}
	}

	/**
	 * One entry point for both directions. Which one a payload is decides itself -
	 * an offer produces a reply, a reply completes the connection - and asking the
	 * user to know which of the two they were handed is asking the wrong person.
	 *
	 * @param {string} text
	 */
	async function usePayload(text) {
		const trimmed = text.trim();

		if (trimmed.length === 0) {
			return;
		}

		busy = true;
		try {
			if (outgoing.length > 0) {
				// The session dials for us since 0.4.0: until something dials there is
				// no libp2p connection, and this app has no protocol of its own to
				// open - OrbitDB and gossipsub use whatever connection exists.
				const { peerId } = await session().acceptAnswer(trimmed);

				status = `Connected to ${peerId.slice(0, 12)}…`;
				outgoing = '';
			} else {
				outgoing = await session().acceptOffer(trimmed);
				status = 'Show this reply back to them.';
			}
			incoming = '';
		} catch (/** @type {any} */ error) {
			status = `That payload was rejected: ${error.message}`;
		} finally {
			busy = false;
		}
	}

	function scan() {
		scanner?.open().catch((/** @type {any} */ error) => {
			status = `Camera failed: ${error.message}`;
		});
	}
</script>

<!--
	Sits directly under the Relay Button FAB, which the @le-space/ui launcher pins
	at bottom 92.8px / right 22.4px with z-index 10000. Deliberately one notch
	lower so the two never fight for the same pixels, and stacked rather than
	side-by-side because the launcher is 166px wide and a row of both would
	overflow a narrow phone.
-->
{#if mounted}
	<button
		class="fixed right-[22.4px] bottom-10 z-[9999] rounded-full bg-amber-500 px-4 py-2 text-sm font-medium tracking-wide whitespace-nowrap text-white shadow-lg hover:bg-amber-600"
		onclick={() => (open = !open)}
		data-testid="qr-toggle"
		aria-expanded={open}
		aria-controls="qr-connect-panel"
	>
		Scan Connect SDP
	</button>
{/if}

{#if open}
	<section
		id="qr-connect-panel"
		class="mb-4 rounded-lg border border-amber-400/40 bg-amber-50 p-4 dark:bg-gray-800"
		data-testid="qr-connect"
	>
		<h2 class="mb-1 text-sm font-semibold">Connect by invite</h2>
		<p class="mb-3 text-xs text-gray-600 dark:text-gray-300">
			A direct WebRTC connection negotiated through a code you hand over yourself — no relay and no
			discovery involved in the introduction.
		</p>

		<div class="flex flex-wrap gap-2">
			<button
				class="rounded bg-amber-500 px-3 py-1 text-sm text-white disabled:opacity-50"
				onclick={createInvite}
				disabled={busy}
				data-testid="qr-create-invite">Create invite</button
			>
			<button
				class="rounded border px-3 py-1 text-sm disabled:opacity-50"
				onclick={scan}
				disabled={busy}
				data-testid="qr-scan">Scan their code</button
			>
		</div>

		{#if outgoing}
			<!--
				Themed entirely from outside through custom properties - the element's
				own defaults are dark, and this app is light by default. If those
				properties did not cross the shadow boundary there would be no way to
				do this without forking the element.
			-->
			<qr-invite
				class="mt-3 block"
				value={outgoing}
				style="--qr-invite-max-width: 320px; --qr-invite-caption-color: #4b5563; --qr-invite-radius: 6px;"
				data-testid="qr-code"
			></qr-invite>
		{/if}

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
			placeholder="Or paste their invite or reply here"
			data-testid="qr-incoming"
			bind:value={incoming}
		></textarea>

		<button
			class="mt-2 rounded border px-3 py-1 text-sm disabled:opacity-50"
			onclick={() => usePayload(incoming)}
			disabled={busy}
			data-testid="qr-use-payload">Use this</button
		>

		<p class="mt-2 text-xs" data-testid="qr-status">{status}</p>

		<qr-scanner
			bind:this={scanner}
			label="Scan their code"
			style="--qr-scanner-background: #ffffff; --qr-scanner-foreground: #111827; --qr-scanner-border: #d1d5db; --qr-scanner-status-color: #4b5563;"
			onscan={(/** @type {any} */ event) => usePayload(event.detail.text)}
		></qr-scanner>
	</section>
{/if}
