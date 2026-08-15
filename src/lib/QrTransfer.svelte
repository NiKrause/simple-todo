<script>
	// The handover, as two people actually perform it.
	//
	// Alice taps "Übertragen" and holds up her code. Bob scans it, and his phone
	// answers with a code of its own. Alice taps "Antwort scannen" and scans
	// that. Three actions, two devices, no network in between.
	//
	// The QR rendering, the camera and the scan loop all come from the package's
	// custom elements (`qr-invite`, `qr-scanner`, `qr-peers`) — the same ones
	// behind https://webrtc-qr.le-space.de. This component only decides *what*
	// is shown and what a scanned payload means, which is the part that belongs
	// to this app rather than to the transport.
	import { onMount, onDestroy } from 'svelte';
	import { parsePayload, QR_TYPE_OFFER, QR_TYPE_ANSWER } from '@le-space/libp2p-webrtc-qr';
	import { getQrSession, qrCodeOnScreen } from './qr-transport.js';
	import { syncWakeLock, releaseWakeLock } from './wake-lock.js';
	import { rtcConfiguration } from './ice-mode.js';
	import { sendListOffer } from './handover-protocol.js';
	import { todoDBAddressStore, activeListStore } from './db-actions.js';
	import { ownDidStore } from './p2p.js';

	/** @type {'idle' | 'offering' | 'answering' | 'connected'} */
	let phase = 'idle';
	/** @type {string} */
	let payload = '';
	/** @type {string | null} */
	let error = null;
	let busy = false;
	let shortCode = false;
	let elementsReady = false;
	let scanning = false;
	/** @type {import('./handover-protocol.js').ListOffer | null} */
	let sentList = null;

	/** @type {any} */
	let inviteEl;
	/** @type {any} */
	let scannerEl;
	/** @type {any} */
	let statusEl;

	onMount(async () => {
		// Custom elements touch `document` and `navigator.mediaDevices` at import
		// time, so they are loaded here rather than at module scope — this app
		// prerenders, and a static build must not need a camera to exist.
		await import('@le-space/libp2p-webrtc-qr/elements');
		elementsReady = true;
		// Set before the element upgrades, so its `auto` probe uses this
		// chapter's ICE settings rather than the package default.
		if (statusEl) statusEl.rtcConfiguration = rtcConfiguration();

		// The camera is the one thing a headless browser cannot supply, so under
		// VITE_E2E the payload can be handed in directly. Everything after that
		// is the same code the scanner drives.
		if (import.meta.env.VITE_E2E === 'true') {
			/** @type {any} */ (window).__simpleTodoQr = {
				transfer,
				offerPayload: () => (phase === 'offering' || phase === 'answering' ? payload : ''),
				phase: () => phase,
				useScannedPayload
			};
		}
	});

	onDestroy(() => {
		if (typeof window !== 'undefined') delete (/** @type {any} */ (window).__simpleTodoQr);
	});

	function session() {
		const active = getQrSession();
		if (!active) throw new Error('The peer-to-peer node is still starting. Try again in a moment.');
		return active;
	}

	/** @param {unknown} err */
	function fail(err) {
		error = err instanceof Error ? err.message : String(err);
	}

	/** Alice: produce an offer and show it. */
	async function transfer() {
		busy = true;
		error = null;
		try {
			// `compact` is per-offer, so the checkbox changes only what this device
			// hands out. Reading is unaffected either way — a scanner accepts both
			// formats whatever the box says.
			payload = await session().createOffer({ compact: shortCode });
			phase = 'offering';
		} catch (err) {
			fail(err);
		} finally {
			busy = false;
		}
	}

	/**
	 * Act on a payload, however it arrived.
	 *
	 * Split out from the camera so a test can exercise the roundtrip: Playwright
	 * has no camera, and a test that stubbed the whole handshake would prove only
	 * that the stub works. This way the scan path and the test path differ in
	 * exactly one step — where the text came from.
	 *
	 * @param {string} text
	 * @param {typeof QR_TYPE_OFFER | typeof QR_TYPE_ANSWER} expected
	 */
	async function useScannedPayload(text, expected) {
		if (expected === QR_TYPE_OFFER) {
			// Bob: answer, and show the answer for Alice to scan back.
			payload = await session().acceptOffer(text);
			phase = 'answering';
		} else {
			// Alice: the roundtrip closes here, and the list follows immediately.
			const { peerId } = await session().acceptAnswer(text);
			phase = 'connected';
			payload = '';
			await offerActiveList(peerId);
		}
	}

	/**
	 * Run the camera once and return what it read.
	 *
	 * `open()` does not resolve with the scanned text — it resolves once the
	 * camera is running. A successful read is announced as a `scan` event
	 * instead. Awaiting `open()` therefore yielded `undefined`, and the code
	 * that produces the answer never ran: the scan visibly succeeded, the
	 * dialog closed, and nothing happened.
	 *
	 * The ordering matters too. On success the element calls `close()` *before*
	 * dispatching `scan`, so treating `close` as "cancelled" swallows the hit.
	 * Cancellation is therefore deferred by a turn, which lets a `scan`
	 * arriving immediately afterwards win.
	 *
	 * @returns {Promise<string | null>} the payload, or null if the user closed it
	 */
	function scanOnce() {
		scanning = true;
		return new Promise((resolve, reject) => {
			/** @param {any} event */
			const onScan = (event) => {
				cleanup();
				resolve(event.detail?.text ?? null);
			};
			const onClose = () => setTimeout(() => (cleanup(), resolve(null)), 0);
			const cleanup = () => {
				scanning = false;
				scannerEl.removeEventListener('scan', onScan);
				scannerEl.removeEventListener('close', onClose);
			};

			scannerEl.addEventListener('scan', onScan);
			scannerEl.addEventListener('close', onClose);
			scannerEl.open().catch((/** @type {unknown} */ err) => {
				cleanup();
				reject(err);
			});
		});
	}

	/**
	 * Open the camera and decide whether what it read is the code this screen is
	 * waiting for.
	 *
	 * Returning `{ ok: false }` keeps the camera running with the reason on
	 * screen, which is what turns "that is a reply, not an invite" into a
	 * message instead of a dead end.
	 *
	 * @param {typeof QR_TYPE_OFFER | typeof QR_TYPE_ANSWER} expected
	 */
	async function scan(expected) {
		error = null;
		scannerEl.label = expected === QR_TYPE_OFFER ? 'Scan their code' : 'Scan their reply';
		scannerEl.validate = async (/** @type {string} */ text) => {
			try {
				const parsed = await parsePayload(text);
				if (parsed.type !== expected) {
					return {
						ok: false,
						reason:
							expected === QR_TYPE_OFFER
								? 'That is a reply, not an invite.'
								: 'That is an invite, not a reply.'
					};
				}
				return { ok: true };
			} catch (err) {
				return { ok: false, reason: err instanceof Error ? err.message : String(err) };
			}
		};

		try {
			const text = await scanOnce();
			if (!text) return;
			await useScannedPayload(text, expected);
		} catch (err) {
			fail(err);
		}
	}

	/**
	 * Hand the peer the address of the list currently open.
	 *
	 * Sent by the side that *scanned the answer*, which is the side that started
	 * the transfer — Alice on the site. The other end only ever receives an
	 * offer, and decides.
	 *
	 * A failure here is reported without unwinding the connection: the handshake
	 * genuinely succeeded, and telling someone their scan failed because a
	 * follow-up message did not land would be a lie about what happened.
	 *
	 * @param {string} peerId
	 */
	async function offerActiveList(peerId) {
		const address = $todoDBAddressStore;
		if (!address) {
			error = 'Connected, but no list is open to send.';
			return;
		}
		try {
			sentList = await sendListOffer(session(), peerId, {
				address,
				name: $activeListStore?.name ?? '',
				ownerDid: $ownDidStore ?? ''
			});
		} catch (err) {
			error = `Connected, but the list could not be sent: ${err instanceof Error ? err.message : String(err)}`;
		}
	}

	function reset() {
		payload = '';
		error = null;
		sentList = null;
		phase = 'idle';
	}

	$: qrCodeOnScreen.set(phase === 'offering' || phase === 'answering');

	// Awake while a code is up *or* the camera is open — both are a person
	// holding a phone still and not touching it, which is precisely when it
	// decides to sleep. An animated code needs several frames; a screen dimming
	// halfway through is worse than one that never lit up.
	$: void syncWakeLock(phase === 'offering' || phase === 'answering' || scanning);

	onDestroy(() => {
		qrCodeOnScreen.set(false);
		void releaseWakeLock();
	});
</script>

<section
	class="mt-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700"
	data-testid="qr-transfer"
>
	<!--
		Step 1: what this device's network can actually do.

		The package's own status element — browser, IPv4, IPv6, camera and an
		overall verdict — with its progress bar while the checks run. `auto` makes
		it probe as soon as it is on screen, which is the point: someone standing
		on a site wants to know whether this will work *before* holding up a code,
		not after a failed scan.

		It gets this chapter's ICE configuration rather than the element's STUN
		default. A diagnostic that measured a transport the app does not use would
		be worse than none — and on a hotspot with no uplink, STUN would make the
		probe sit through its timeouts for nothing.
	-->
	<qr-status
		bind:this={statusEl}
		auto
		rows="browser ipv4 ipv6 camera overall"
		data-testid="qr-network-status"
	></qr-status>

	<div class="mt-3 flex flex-wrap items-center gap-2">
		<h2 class="mr-auto text-sm font-semibold text-heading">Transfer a list</h2>

		{#if phase === 'idle'}
			<button
				type="button"
				class="rounded bg-cyan-600 px-3 py-1 text-xs text-white hover:bg-cyan-700 disabled:opacity-50"
				disabled={busy || !elementsReady}
				on:click={transfer}
				data-testid="qr-transfer-start">{busy ? 'Working…' : 'Übertragen'}</button
			>
			<button
				type="button"
				class="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
				disabled={!elementsReady}
				on:click={() => scan(QR_TYPE_OFFER)}
				data-testid="qr-transfer-scan">Scan their code</button
			>
		{:else if phase === 'offering'}
			<button
				type="button"
				class="rounded bg-cyan-600 px-3 py-1 text-xs text-white hover:bg-cyan-700"
				on:click={() => scan(QR_TYPE_ANSWER)}
				data-testid="qr-transfer-scan-answer">Antwort scannen</button
			>
			<button
				type="button"
				class="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
				on:click={reset}
				data-testid="qr-transfer-cancel">Cancel</button
			>
		{:else}
			<button
				type="button"
				class="rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
				on:click={reset}
				data-testid="qr-transfer-done">Done</button
			>
		{/if}
	</div>

	{#if error}
		<p class="mt-2 text-xs text-red-600 dark:text-red-400" data-testid="qr-transfer-error">
			{error}
		</p>
	{/if}

	{#if phase === 'idle'}
		<label class="mt-3 flex items-start gap-2 text-xs text-faint">
			<input type="checkbox" bind:checked={shortCode} data-testid="qr-transfer-short-code" />
			<span>
				Short code instead of an animated one
				<!-- Off by default, following the package's own demo: a connection
				     rebuilt from a reconstructed SDP goes quiet under load often
				     enough that the smaller code is not worth it (webrtc-qr #6). This
				     chapter then replicates a database over that connection, which is
				     exactly the load in question — so the animated code is the safe
				     default and this stays an informed choice. -->
				<small class="block text-faint"
					>Experimental. One static code instead of an animated sequence, but the connection it
					builds is less reliable under load.</small
				>
			</span>
		</label>
	{/if}

	{#if phase === 'offering' || phase === 'answering'}
		<p class="mt-3 text-xs text-faint">
			{phase === 'offering'
				? 'Hold this up to be scanned, then tap "Antwort scannen".'
				: 'Show this back to them — they scan it to finish the connection.'}
		</p>
		<qr-invite bind:this={inviteEl} value={payload} data-testid="qr-transfer-code"></qr-invite>
	{/if}

	{#if phase === 'connected'}
		<p class="mt-3 text-xs text-faint" data-testid="qr-transfer-connected">
			{#if sentList}
				Connected. Sent <strong>{sentList.name || 'the open list'}</strong> — they decide whether to
				import it.
			{:else}
				Connected.
			{/if}
		</p>
		<qr-peers></qr-peers>
	{/if}

	<qr-scanner bind:this={scannerEl}></qr-scanner>
</section>
