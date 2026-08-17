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
					{:else if verdict === 'open' || verdict === 'relay'}
						{$_('intro.check.routable')}
					{:else if verdict === 'symmetric'}
						{$_('intro.check.localOnly')}
					{:else}
						{$_('intro.check.none')}
					{/if}
				</p>
				{#if verdict !== null && verdict !== 'open' && verdict !== 'relay'}
					<p class="mt-1 text-xs text-faint">{$_('intro.check.sameNetwork')}</p>
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
