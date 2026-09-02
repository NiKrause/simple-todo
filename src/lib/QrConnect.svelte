<script>
	import { _ } from '$lib/i18n/index.js';
	import { onMount } from 'svelte';
	import { getQrSession } from './qr-transport.js';
	import { isRelayNetworkMode } from './network-mode.js';
	import { buildInviteLink, clearInviteLink, readInviteLink } from './invite-link.js';

	// Mounted on every page: the invite is a second way to meet a peer, next to
	// the relay. Whether the panel *starts* open depends on whether there is any
	// other way to connect — with the relay network switched off (consent screen,
	// or `?transport=qr`) an invite is the only one, so opening it is the whole
	// interface rather than an extra.
	let mounted = $state(false);
	let open = $state(false);
	let outgoing = $state('');
	let incoming = $state('');
	/**
	 * The status line, as a key and its values rather than a sentence.
	 *
	 * It was assigned English prose at eleven points. Storing the key means the
	 * line follows a language switch made *after* it was set — which is the
	 * ordinary case here, since the switch lives in the dialog somebody has just
	 * come through.
	 *
	 * @type {{ key: string, values?: any }}
	 */
	let status = $state({ key: 'qr.lead' });
	let busy = $state(false);
	/** @type {any} */
	let scanner = $state(null);
	let linkCopied = $state(false);
	/** @type {HTMLElement | undefined} */
	let root = $state();

	/**
	 * Opening the panel is not enough to make it visible: it lives inside the
	 * collapsed "Network details" disclosure, so anything that opens it *for* the
	 * user - invite-only mode, or arriving through an invite link - has to expand
	 * that too, or the panel is on screen only in the DOM sense.
	 */
	function reveal() {
		open = true;
		root?.closest('details')?.setAttribute('open', '');
	}

	onMount(async () => {
		if (!isRelayNetworkMode()) {
			reveal();
		}

		// Loaded in the browser only: SvelteKit renders this page on the server
		// first, where `customElements` does not exist.
		await import('@le-space/libp2p-webrtc-qr/elements');
		mounted = true;

		// Someone opened a link that carries an invite. Show them what is
		// happening rather than connecting invisibly, and consume the fragment so
		// a reload does not replay a spent offer.
		await consumeInviteLink();

		// Opening an invite link while this page is already loaded only changes the
		// fragment, which is a same-document navigation: no reload, no onMount. The
		// invite would be silently ignored without this.
		window.addEventListener('hashchange', () => {
			void consumeInviteLink();
		});
	});

	async function consumeInviteLink() {
		const invited = readInviteLink();

		if (invited) {
			reveal();
			clearInviteLink();
			status = { key: 'qr.received' };

			// A first-time visitor lands on the consent screen, so at this point
			// there is usually no libp2p node yet — accepting consent is what
			// creates it. Applying the invite here would fail before the user had
			// any chance to act on it.
			if (await waitForSession()) {
				await usePayload(invited);
			} else {
				status = { key: 'qr.neverStarted' };
			}
		}
	}

	/**
	 * Resolves once the QR session exists, or false if it never does.
	 *
	 * Polls rather than subscribing to `libp2pStore`: that store is set one line
	 * *before* `attachQrSession`, so reacting to it would still be a hair early.
	 *
	 * @param {number} [timeoutMs]
	 */
	async function waitForSession(timeoutMs = 120_000) {
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			if (getQrSession() != null) {
				return true;
			}

			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		return false;
	}

	async function copyInviteLink() {
		try {
			await navigator.clipboard.writeText(buildInviteLink(outgoing));
			linkCopied = true;
			status = { key: 'qr.linkCopiedHint' };
		} catch (/** @type {any} */ error) {
			// Clipboard access is denied in plenty of ordinary situations (no
			// secure context, no user gesture). The link is still in the box below,
			// so say so instead of failing silently.
			linkCopied = false;
			status = { key: 'qr.copyFailed', values: { reason: error.message } };
		}
	}

	function session() {
		const current = getQrSession();

		if (current == null) {
			throw new Error($_('qr.peerStarting'));
		}

		return current;
	}

	async function createInvite() {
		busy = true;
		linkCopied = false;
		try {
			outgoing = await session().createOffer();
			status = { key: 'qr.showCode' };
		} catch (/** @type {any} */ error) {
			status = { key: 'qr.createFailed', values: { reason: error.message } };
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

				status = { key: 'qr.connectedTo', values: { peer: peerId.slice(0, 12) } };
				outgoing = '';
				// The panel has done its job. Left open it hides the todo list behind
				// a wall of one-time payloads that are already spent. Delayed so the
				// confirmation is readable rather than a flash.
				closeWhenConnected();
			} else {
				outgoing = await session().acceptOffer(trimmed);
				status = { key: 'qr.showReply' };
			}
			incoming = '';
		} catch (/** @type {any} */ error) {
			status = { key: 'qr.rejected', values: { reason: error.message } };
		} finally {
			busy = false;
		}
	}

	/** Collapse the panel a moment after a connection is established. */
	function closeWhenConnected() {
		setTimeout(() => {
			open = false;
			incoming = '';
			linkCopied = false;
			status = { key: 'qr.lead' };
		}, 2000);
	}

	function scan() {
		scanner?.open().catch((/** @type {any} */ error) => {
			status = { key: 'qr.cameraFailed', values: { reason: error.message } };
		});
	}
</script>

<!--
	An inline launcher next to the relay controls, not a floating one. It used to
	be pinned to the viewport corner alongside the Relay Button FAB, which put the
	answer to "how do I reach anybody" somewhere nobody was asking the question -
	and covered the app on small screens.
-->
<span bind:this={root} class="contents"></span>

{#if mounted}
	<button
		class="rounded-full bg-amber-500 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-white hover:bg-amber-600"
		onclick={() => (open = !open)}
		data-testid="qr-toggle"
		aria-expanded={open}
		aria-controls="qr-connect-panel"
	>
		{$_('qr.scanConnectSdp')}
	</button>
{/if}

{#if open}
	<section
		id="qr-connect-panel"
		class="mt-3 w-full rounded-lg border border-amber-400/40 bg-amber-50 p-4 dark:bg-gray-800"
		data-testid="qr-connect"
	>
		<h2 class="mb-1 text-sm font-semibold">{$_('qr.connectByInvite')}</h2>
		<p class="mb-3 text-xs text-gray-600 dark:text-gray-300">
			A direct WebRTC connection negotiated through a code you hand over yourself — no relay and no
			discovery involved in the introduction.
		</p>

		<div class="flex flex-wrap gap-2">
			<button
				class="rounded bg-amber-500 px-3 py-1 text-sm text-white disabled:opacity-50"
				onclick={createInvite}
				disabled={busy}
				data-testid="qr-create-invite">{$_('qr.createInvite')}</button
			>
			<button
				class="rounded border px-3 py-1 text-sm disabled:opacity-50"
				onclick={scan}
				disabled={busy}
				data-testid="qr-scan">{$_('qr.scanCode')}</button
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

		{#if outgoing}
			<!--
				A link for the case the camera is not an option: a different device,
				a chat window, a phone call. The payload rides in the fragment, so it
				never reaches the server or an IPFS gateway on the way.
			-->
			<button
				class="mt-2 rounded border px-3 py-1 text-sm disabled:opacity-50"
				onclick={copyInviteLink}
				disabled={busy}
				data-testid="qr-copy-link">{linkCopied ? $_('qr.linkCopied') : $_('qr.copyLink')}</button
			>
		{/if}

		<textarea
			class="mt-2 w-full rounded border p-2 font-mono text-xs dark:bg-gray-900"
			rows="2"
			placeholder={$_('qr.pasteHere')}
			data-testid="qr-incoming"
			bind:value={incoming}
		></textarea>

		<button
			class="mt-2 rounded border px-3 py-1 text-sm disabled:opacity-50"
			onclick={() => usePayload(incoming)}
			disabled={busy}
			data-testid="qr-use-payload">{$_('qr.use')}</button
		>

		<p class="mt-2 text-xs" data-testid="qr-status">{$_(status.key, { values: status.values })}</p>

		<qr-scanner
			bind:this={scanner}
			label={$_('qr.scanCode')}
			style="--qr-scanner-background: #ffffff; --qr-scanner-foreground: #111827; --qr-scanner-border: #d1d5db; --qr-scanner-status-color: #4b5563;"
			onscan={(/** @type {any} */ event) => usePayload(event.detail.text)}
		></qr-scanner>
	</section>
{/if}
