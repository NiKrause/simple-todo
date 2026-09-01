<script>
	// What this app is, before somebody has to guess it from a list.
	//
	// The dialog itself is `<qr-intro>` from the transport package. Its half is
	// the part every app built on this transport needs and would otherwise write
	// from memory — whether a phone holds a waiting invite, whether Chrome on
	// Android reports IPv6, what a VPN does to a direct connection — plus the
	// measurement those caveats are worth giving advice from.
	//
	// This file supplies the half that is ours: the story, the language and view
	// switches, the advice under the verdict, the Close button, and the relay
	// check. They reach the element through its named slots, which exist because
	// this app is what showed they had to (libp2p-webrtc-qr#107).
	//
	// The switches sit in here rather than in the page header because this is the
	// first thing a person sees: sending them to the header to change the
	// language of the dialog they are currently failing to read would be a poor
	// joke.
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { _ } from '$lib/i18n/index.js';
	import { simpleView } from './view-mode.js';
	import { introOpen, closeIntro } from './intro-dialog.js';
	import LanguageSwitcher from './LanguageSwitcher.svelte';
	import ViewModeToggle from './ViewModeToggle.svelte';
	import { diagnosticRtcConfiguration } from './ice-mode.js';
	import { ownDidStore } from './p2p-stores.js';
	import {
		RELAY_OPT_IN_STORAGE_KEY,
		relayOptIn,
		relayVerdict,
		hydrateRelayOptIn,
		checkRelayAvailability
	} from './relay-availability.js';

	/** @type {any} */
	let introEl;
	/** @type {any} */
	let statusEl;
	let ready = false;
	/** @type {any} */
	let networkResult = null;

	/**
	 * The element's own text, folded over its English defaults.
	 *
	 * Rebuilt whenever the language or the view changes, because the verdict is
	 * written twice: "symmetric NAT" is the accurate description and it belongs
	 * in the technical view. Somebody who came here to hand a list to the person
	 * next to them cannot act on a NAT taxonomy, and a paragraph of it costs
	 * them the two facts that do matter — same network works, the internet needs
	 * a VPN.
	 */
	$: strings = {
		title: $_('intro.title'),
		close: $_('intro.close'),
		checkHeading: $_('intro.check.heading'),
		checking: $_('intro.check.checking'),
		ok: $simpleView ? $_('intro.check.simple.ok') : $_('intro.check.routable'),
		unreliable: $simpleView ? $_('intro.check.simple.limited') : $_('intro.check.localOnly'),
		none: $_('intro.check.none'),
		sameNetwork: $_('intro.check.sameNetwork'),
		technicalHeading: $_('intro.tech.heading'),
		technical: [
			$_('intro.tech.nat'),
			$_('intro.tech.chromeIpv6'),
			$_('intro.tech.browsers'),
			$_('intro.tech.graphene'),
			$_('intro.tech.vpn')
		],
		dontShow: $_('intro.dontShow'),
		waysHeading: $_('intro.ways.heading'),
		// The ways section is the one place that tells a person what to *do*, and
		// it only ever offered the camera. With a relay answering, a code is not
		// required at all — saying so at that moment is the difference between
		// the dialog describing the app and describing this network right now.
		// (`wayRelay` does not exist in the element, so this rides on `wayQr`.)
		wayQr:
			$relayVerdict === 'baked' || $relayVerdict === 'aleph'
				? $_('intro.ways.qrWithRelay')
				: $_('intro.ways.qr'),
		relayLabel: $_('intro.relay.label'),
		relayHint: $_('intro.relay.hint'),
		relayChecking: $_('intro.relay.checking'),
		// Functions, because these carry a count and the plural rules are the
		// translation's business rather than ours.
		relayReachable: (/** @type {{ count: number }} */ values) =>
			$_('intro.relay.reachable', { values }),
		relayDiscovered: (/** @type {{ count: number }} */ values) =>
			$_('intro.relay.discovered', { values }),
		relayNone: $_('intro.relay.none'),
		privacyHeading: $_('intro.privacy.heading'),
		privacyEmpty: $_('intro.privacy.empty'),
		privacyAccept: $_('intro.privacy.accept')
	};

	/**
	 * The statement, assembled from what was actually chosen.
	 *
	 * A generic notice describes an app nobody is running, and a tick against one
	 * confirms nothing. These sentences are ours rather than the element's for the
	 * same reason: what this app does with somebody's data is this app's to say.
	 *
	 * Defined once and reading the translation at call time, not rebuilt whenever
	 * the language changes. The element calls this on every repaint, and assigning
	 * `strings` is itself a repaint - so a switch to German reaches these
	 * sentences on the same pass that reaches the labels around them.
	 *
	 * @param {any} state
	 */
	const clauses = (state) =>
		[
			get(_)('intro.privacy.noServer'),
			get(_)('intro.privacy.qr'),
			state.relayOptIn ? get(_)('intro.privacy.relayOn') : get(_)('intro.privacy.relayOff'),
			state.identity === 'passkey'
				? get(_)('intro.privacy.passkey')
				: get(_)('intro.privacy.throwaway'),
			get(_)('intro.privacy.local')
		].filter(Boolean);

	$: if (ready) introEl.privacy = { accept: true, clauses };

	// The identity is the app's half of the state the clauses read. Reported as
	// a word rather than a DID: the panel says what kind of identity signs the
	// entries, and the DID itself would be neither readable nor relevant there.
	$: if (ready) introEl.choices = { identity: $ownDidStore ? 'passkey' : 'throwaway' };

	$: if (ready) introEl.strings = strings;
	$: if (ready) introEl.technical = !$simpleView;

	// Opening is the app's decision — `intro-dialog.js` knows about first visits
	// and about arriving by invite — so the store drives the element rather than
	// the other way round.
	$: if (ready && $introOpen && !introEl.isOpen) void introEl.open();
	$: if (ready && !$introOpen && introEl.isOpen) introEl.close();

	/** @type {'unknown' | 'routable' | 'limited'} */
	let verdict = 'unknown';

	/**
	 * The chips, painted from the measurement the element already made.
	 *
	 * `qr-status` has a `renderResult` method, so showing the detail costs no
	 * second probe — the earlier version of this file dropped the chips on the
	 * assumption that it would. Three rows rather than five: `renderResult`
	 * paints what it is handed, and the browser and camera rows come from
	 * `probeBrowser`/`probeCamera`, which this measurement does not include.
	 */
	function paintChips() {
		if (statusEl && networkResult) statusEl.renderResult(networkResult);
	}

	// Mounted only in the technical view, so it is a fresh element each time the
	// switch is thrown — and each one needs painting.
	$: if (!$simpleView && statusEl && networkResult) paintChips();

	onMount(async () => {
		hydrateRelayOptIn();
		await import('@le-space/libp2p-webrtc-qr/elements');

		introEl.rtcConfiguration = diagnosticRtcConfiguration();
		introEl.strings = strings;
		introEl.technical = !$simpleView;
		// Assigned before the first `open()`, so a remembered yes is checked as
		// the dialog appears rather than one interaction later.
		introEl.relay = {
			check: checkRelayAvailability,
			storageKey: RELAY_OPT_IN_STORAGE_KEY
		};

		introEl.addEventListener('check', (/** @type {any} */ event) => {
			// Three states collapse to two here. The advice below the verdict is
			// the same for "symmetric NAT" and "no path at all" — same network
			// works, the internet needs a VPN — and offering a person two shades
			// of bad news they cannot act on differently is not information.
			const state = event.detail?.overall?.state;
			verdict = state === 'open' || state === 'relay' ? 'routable' : 'limited';
			networkResult = event.detail;
			paintChips();
		});
		introEl.addEventListener('relay-opt-in', (/** @type {any} */ event) => {
			relayOptIn.set(event.detail.optIn === true);
			if (event.detail.optIn !== true) relayVerdict.set('idle');
		});
		introEl.addEventListener('relay-check', (/** @type {any} */ event) => {
			relayVerdict.set(event.detail?.source ?? 'none');
		});
		introEl.addEventListener('close', (/** @type {any} */ event) => {
			closeIntro(event.detail?.remember === true);
		});

		ready = true;
	});
</script>

<!--
	Rendered always rather than behind `{#if $introOpen}`. The element holds the
	measurement it has already made and the relay configuration it was given;
	unmounting it between openings would throw both away and probe again.
-->
<qr-intro bind:this={introEl} data-testid="intro-dialog">
	<div slot="header" class="flex shrink-0 items-center gap-2">
		<LanguageSwitcher />
		<ViewModeToggle />
	</div>

	<div class="space-y-3 text-sm">
		<p>{$_('intro.simple.lead')}</p>
		<p>{$_('intro.simple.offline')}</p>
		<p>{$_('intro.simple.hotspot')}</p>
		<p>{$_('intro.simple.passkey')}</p>
	</div>

	<!--
		What to *do* about it, under the verdict it follows from. Split around the
		link rather than rendered through `{@html}`: the surrounding sentences are
		translations, and an interpolation habit here is the one that later gets
		pointed at a user-supplied string.
	-->
	{#if verdict === 'limited'}
		<p slot="advice" class="text-xs" data-testid="intro-vpn-advice">
			{#if $simpleView}
				{$_('intro.check.simple.limitedBefore')}<a
					href="https://nymvpn.com/"
					target="_blank"
					rel="noopener noreferrer"
					class="underline">{$_('intro.check.vpnLink')}</a
				>{$_('intro.check.simple.limitedAfter')}
			{:else}
				{$_('intro.check.vpnBefore')}<a
					href="https://nymvpn.com/"
					target="_blank"
					rel="noopener noreferrer"
					class="underline">{$_('intro.check.vpnLink')}</a
				>{$_('intro.check.vpnAfter')}
			{/if}
		</p>
	{/if}

	<!-- The detail, for whoever wants it rather than the sentence. In the advice
	     slot because that is where it belongs: directly under the verdict it is
	     the long form of. -->
	{#if !$simpleView}
		<qr-status
			slot="advice"
			bind:this={statusEl}
			rows="ipv4 ipv6 overall"
			data-testid="intro-network-chips"
		></qr-status>
	{/if}

	<button
		slot="footer"
		type="button"
		on:click={() => introEl.close()}
		data-testid="intro-close"
		class="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700"
	>
		{$_('intro.close')}
	</button>
</qr-intro>

<style>
	/* The element themes itself from custom properties, so it takes the app's
	   palette rather than arriving as a stranger — and it follows the dark mode
	   with it, because these variables are what `.dark` redefines in app.css. */
	qr-intro {
		--qr-intro-background: var(--surface);
		--qr-intro-color: var(--text);
		--qr-intro-border: var(--border);
		--qr-intro-muted: var(--faint);
		--qr-intro-accent: var(--cyan);
	}
</style>
