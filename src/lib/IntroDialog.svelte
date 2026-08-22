<script>
	// What this app is, before somebody has to guess it from a list.
	//
	// It carries the language flags and the simple/technical switch itself,
	// because this is the first thing a person sees: sending them to the header
	// to change the language of the dialog they are currently failing to read
	// would be a poor joke.
	import { onMount } from 'svelte';
	import { _ } from '$lib/i18n/index.js';
	import { simpleView } from './view-mode.js';
	import { introOpen, closeIntro } from './intro-dialog.js';
	import LanguageSwitcher from './LanguageSwitcher.svelte';
	import ViewModeToggle from './ViewModeToggle.svelte';
	import { diagnosticRtcConfiguration } from './ice-mode.js';
	import {
		relayOptIn,
		relayVerdict,
		hydrateRelayOptIn,
		setRelayOptIn,
		findReachableRelays
	} from './relay-availability.js';
	import { bakedRelayBootstrapAddrs } from './libp2p-config.js';
	import { selectValidBrowserBootstrapMultiaddrs } from './bootstrap-multiaddrs.js';
	import { libp2pStore } from './p2p.js';

	let dontShowAgain = false;
	let probeStarted = false;
	/** @type {any} */
	let statusEl;
	/** `null` while the probe is still running. */
	/** @type {'open' | 'relay' | 'symmetric' | 'blocked' | null} */
	let verdict = null;

	/**
	 * The verdict comes from `qr-status`, not from a second probe of my own.
	 *
	 * The first version of this counted *any* ICE candidate and therefore always
	 * said "usable": every device has host candidates, its own LAN addresses.
	 * On a mobile network it cheerfully reported "good to go" while the chips
	 * two panels above said `local only` — the app contradicting itself, in
	 * front of the person least able to tell which half to believe.
	 *
	 * `probeNetwork` counts reflexive candidates only, which are the sole
	 * evidence that anything beyond this network answers. It is not exported
	 * from the package entry, so the element — which has a `result` getter and
	 * emits `probe` — is both the correct source and the only stable one.
	 */
	async function startProbe() {
		await import('@le-space/libp2p-webrtc-qr/elements');
		if (!statusEl) return;
		// Assigned before asking it to probe, so the measurement uses STUN rather
		// than the element's own default.
		statusEl.rtcConfiguration = diagnosticRtcConfiguration();
		statusEl.addEventListener('probe', (/** @type {any} */ event) => {
			verdict = event.detail?.overall?.state ?? 'blocked';
		});
		try {
			await statusEl.probe();
		} catch {
			// A probe that cannot run tells us nothing better than "no path found".
			verdict = 'blocked';
		}
	}

	/**
	 * Relay availability, checked only on request.
	 *
	 * `waiting` is its own state rather than folded into `checking`: the ping
	 * needs a running libp2p node, and a tick during startup would otherwise
	 * report "no relay answered" when the truth is that nothing was asked yet.
	 * That is the failure mode this whole check exists to remove.
	 */
	/** @type {'idle' | 'waiting' | 'checking' | 'baked' | 'aleph' | 'none'} */
	let relayState = 'idle';
	// Mirrored rather than read from the store, because the markup below reads it
	// a dozen times and a local is cheaper; the store exists for the page.
	$: relayVerdict.set(relayState);
	let relayCount = 0;
	let relayCheckRunning = false;

	async function checkRelays() {
		if (relayCheckRunning) return;
		// Idle means nobody has asked yet, waiting means somebody asked before
		// there was a node to ask with. Any other value means this already ran.
		if (relayState !== 'idle' && relayState !== 'waiting') return;
		relayCheckRunning = true;
		relayState = 'checking';
		try {
			const [{ probeRelayAddresses }, { pingMultiaddr }] = await Promise.all([
				import('./relay-probe.js'),
				import('./p2p.js')
			]);
			const result = await findReachableRelays({
				baked: bakedRelayBootstrapAddrs(),
				probe: (candidates) => probeRelayAddresses(candidates, { ping: pingMultiaddr }),
				// Imported here, not at module scope: a start with the box unticked
				// must not even load the Aleph client, let alone call it.
				discover: async () => {
					const { discoverScopedBootstrapMultiaddrs } = await import(
						'./aleph-bootstrap-discovery.js'
					);
					// Scoped exactly as `ManualConnectForm` scopes it. The channel is
					// public and holds orphaned registrations of long-erased relays
					// (#84); an unscoped query would spend the probe budget on corpses.
					const discovered = await discoverScopedBootstrapMultiaddrs({
						profile: import.meta.env.VITE_RELAY_BOOTSTRAP_PROFILE || 'orbitdb-relay',
						registrationId:
							import.meta.env.VITE_RELAY_BOOTSTRAP_REGISTRATION_ID ||
							'relay:orbitdb-relay:orbitdb-relay'
					});
					return selectValidBrowserBootstrapMultiaddrs(discovered);
				}
			});
			relayCount = result.addresses.length;
			relayState = result.source;

			// Finding one is not using one. The node was built without a relay in
			// its bootstrap list — that is what the unticked box buys — so the
			// reservation only happens if we dial now. First reachable address is
			// enough: they are already sorted by the probe, and one reservation is
			// all a circuit needs.
			if (result.addresses.length > 0) {
				const { connectToMultiaddr } = await import('./p2p.js');
				try {
					await connectToMultiaddr(result.addresses[0]);
				} catch {
					// The ping answered and the dial did not. Rare, and not worth a
					// second verdict line — the addresses stay listed as reachable.
				}
			}
		} catch {
			// Nothing answered and nothing could be asked — for the person reading
			// this line the two are the same fact.
			relayCount = 0;
			relayState = 'none';
		} finally {
			relayCheckRunning = false;
		}
	}

	function toggleRelay(/** @type {Event} */ event) {
		const on = /** @type {HTMLInputElement} */ (event.currentTarget).checked;
		setRelayOptIn(on);
		if (!on) {
			relayState = 'idle';
			relayCount = 0;
			return;
		}
		// Ticking the box starts the check at once. An opt-in that only takes
		// effect on the next connection attempt leaves the person guessing, which
		// is the state this replaces.
		relayState = 'waiting';
	}

	// Fires when both conditions hold, whichever arrives last: the box is ticked
	// and there is a node to ping from. A remembered tick therefore also checks
	// on startup, without the dialog having to ask again.
	//
	// Whether a check is due is `checkRelays`'s own business, not this line's. It
	// used to be tested here, which made the reactive statement read the state
	// that the function it calls writes — a cycle on paper, and one the linter
	// was right to flag even though it terminates. The guard belongs with the
	// thing it guards.
	$: if ($relayOptIn && $libp2pStore) void checkRelays();

	onMount(hydrateRelayOptIn);

	// Subscribed rather than done with `$:`. A reactive block that reads
	// `verdict` and calls something that writes it is a loop as far as the
	// linter is concerned, and it is right to be suspicious — the guard that
	// makes it terminate lives inside the function it cannot see.
	onMount(() =>
		introOpen.subscribe((open) => {
			if (!open || probeStarted) return;
			probeStarted = true;
			void startProbe();
		})
	);
</script>

{#if $introOpen}
	<div
		class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
		data-testid="intro-dialog"
	>
		<div class="w-full max-w-xl rounded-lg border border-border bg-surface p-5 shadow-xl">
			<div class="flex items-start justify-between gap-3">
				<h2 class="text-lg font-semibold text-heading">{$_('intro.title')}</h2>
				<div class="flex shrink-0 items-center gap-2">
					<LanguageSwitcher />
					<ViewModeToggle />
				</div>
			</div>

			<div class="mt-4 space-y-3 text-sm text-text">
				<p>{$_('intro.simple.lead')}</p>
				<p>{$_('intro.simple.offline')}</p>
				<p>{$_('intro.simple.hotspot')}</p>
				<p>{$_('intro.simple.passkey')}</p>
			</div>

			<div class="mt-4 rounded-md border border-border p-3" data-testid="intro-network-check">
				<p class="text-xs font-medium text-heading">{$_('intro.check.heading')}</p>
				<p
					class="mt-1 flex items-center gap-2 text-xs text-faint"
					data-testid="intro-network-verdict"
					data-state={verdict ?? 'checking'}
				>
					{#if verdict === null}
						<!-- The probe takes up to six seconds. A bare line of text for that
						     long reads as stuck, and if the answer turns out to be bad news,
						     the silence makes it look like a fault rather than a finding. -->
						<span
							class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent"
							aria-hidden="true"
						></span>
						{$_('intro.check.checking')}
					{:else if $simpleView}
						<!--
							One line, and it names the way out rather than the obstacle.
							"Symmetric NAT" is the accurate description and it belongs in the
							technical view: somebody who came here to hand a list to the person
							next to them cannot act on a NAT taxonomy, and a paragraph of it
							costs them the two facts that do matter — same network works, the
							internet needs a VPN.
						-->
						{#if verdict === 'open' || verdict === 'relay'}
							{$_('intro.check.simple.ok')}
						{:else}
							<span data-testid="intro-vpn-advice"
								>{$_('intro.check.simple.limitedBefore')}<a
									href="https://nymvpn.com/"
									target="_blank"
									rel="noopener noreferrer"
									class="text-cyan-700 underline dark:text-cyan-400">{$_('intro.check.vpnLink')}</a
								>{$_('intro.check.simple.limitedAfter')}</span
							>
						{/if}
					{:else if verdict === 'open' || verdict === 'relay'}
						{$_('intro.check.routable')}
					{:else if verdict === 'symmetric'}
						{$_('intro.check.localOnly')}
					{:else}
						{$_('intro.check.none')}
					{/if}
				</p>
				{#if !$simpleView && verdict !== null && verdict !== 'open' && verdict !== 'relay'}
					<p class="mt-1 text-xs text-faint">{$_('intro.check.sameNetwork')}</p>
					<!--
						What to *do* about it, not just what is broken. Split around the link
						rather than rendered through `{@html}`: the surrounding sentences are
						translations, and an interpolation habit here is the one that later
						gets pointed at a user-supplied string.
					-->
					<p class="mt-1 text-xs text-faint" data-testid="intro-vpn-advice-technical">
						{$_('intro.check.vpnBefore')}<a
							href="https://nymvpn.com/"
							target="_blank"
							rel="noopener noreferrer"
							class="text-cyan-700 underline dark:text-cyan-400">{$_('intro.check.vpnLink')}</a
						>{$_('intro.check.vpnAfter')}
					</p>
				{/if}
				<!-- The chips themselves, for anyone who wants the detail rather than
				     the sentence. Hidden rather than unmounted in the simple view: the
				     element is what performs the measurement. -->
				<div class="mt-2" class:hidden={$simpleView}>
					<qr-status
						bind:this={statusEl}
						rows="browser ipv4 ipv6 camera overall"
						data-testid="intro-network-chips"
					></qr-status>
				</div>
			</div>

			<div class="mt-3 rounded-md border border-border p-3" data-testid="intro-relay">
				<label class="flex items-start gap-2 text-xs text-text">
					<input
						type="checkbox"
						class="mt-0.5"
						checked={$relayOptIn}
						on:change={toggleRelay}
						data-testid="intro-relay-optin"
					/>
					<span>
						<span class="font-medium text-heading">{$_('intro.relay.label')}</span>
						<span class="mt-0.5 block text-faint">{$_('intro.relay.hint')}</span>
					</span>
				</label>

				{#if relayState !== 'idle'}
					<p
						class="mt-2 flex items-center gap-2 text-xs text-faint"
						data-testid="intro-relay-result"
						data-state={relayState}
					>
						{#if relayState === 'waiting' || relayState === 'checking'}
							<span
								class="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-cyan-600 border-t-transparent"
								aria-hidden="true"
							></span>
							{$_('intro.relay.checking')}
						{:else if relayState === 'baked'}
							{$_('intro.relay.reachable', { values: { count: relayCount } })}
						{:else if relayState === 'aleph'}
							{$_('intro.relay.discovered', { values: { count: relayCount } })}
						{:else}
							{$_('intro.relay.none')}
						{/if}
					</p>
				{/if}
			</div>

			{#if !$simpleView}
				<div class="mt-4 border-t border-border pt-3" data-testid="intro-technical">
					<p class="text-xs font-medium text-heading">{$_('intro.tech.heading')}</p>
					<ul class="mt-2 space-y-1.5 text-xs text-faint">
						<li>{$_('intro.tech.nat')}</li>
						<li>{$_('intro.tech.chromeIpv6')}</li>
						<li>{$_('intro.tech.browsers')}</li>
						<li>{$_('intro.tech.graphene')}</li>
						<li>{$_('intro.tech.vpn')}</li>
					</ul>
				</div>
			{/if}

			<div class="mt-5 flex flex-wrap items-center justify-between gap-3">
				<label class="flex items-center gap-2 text-xs text-text">
					<input type="checkbox" bind:checked={dontShowAgain} data-testid="intro-dont-show" />
					{$_('intro.dontShow')}
				</label>
				<button
					type="button"
					on:click={() => closeIntro(dontShowAgain)}
					data-testid="intro-close"
					class="rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700"
				>
					{$_('intro.close')}
				</button>
			</div>
		</div>
	</div>
{/if}
