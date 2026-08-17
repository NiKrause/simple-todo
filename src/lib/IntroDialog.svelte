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
	import { rtcConfiguration } from './ice-mode.js';

	let dontShowAgain = false;
	let probeStarted = false;
	/** @type {'checking' | 'ok' | 'none'} */
	let candidates = 'checking';

	// Measured, not asserted. The advice below is only worth giving when this
	// device actually has no usable path — telling two phones already sharing a
	// hotspot to install a VPN would be wrong, so `sameNetwork` sits next to the
	// verdict rather than being folded into it.
	//
	// This runs its own gathering rather than reusing `qr-status`, because that
	// element renders only in the technical view and this verdict is needed most
	// by the person who never leaves the simple one.
	async function probeCandidates() {
		if (typeof RTCPeerConnection === 'undefined') {
			candidates = 'none';
			return;
		}
		const pc = new RTCPeerConnection(rtcConfiguration());
		let found = false;
		try {
			pc.createDataChannel('probe');
			pc.onicecandidate = (event) => {
				// An empty candidate is the end-of-gathering marker, not a path.
				if (event.candidate?.candidate) found = true;
			};
			await pc.setLocalDescription(await pc.createOffer());
			await new Promise((resolve) => {
				const done = () => resolve(undefined);
				pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done();
				// Gathering can stall behind a timeout on a network with no uplink,
				// which is exactly the case this dialog exists to describe — so the
				// verdict must not wait for it indefinitely.
				setTimeout(done, 4000);
			});
		} catch {
			// Treated as "no path": a probe that cannot run tells us nothing better.
		} finally {
			pc.close();
		}
		candidates = found ? 'ok' : 'none';
	}

	// Subscribed rather than done with `$:`. A reactive block that reads
	// `candidates` and calls something that writes it is a loop as far as the
	// linter is concerned, and it is right to be suspicious — the guard that
	// makes it terminate lives inside the function it cannot see.
	onMount(() =>
		introOpen.subscribe((open) => {
			if (!open || probeStarted) return;
			probeStarted = true;
			void probeCandidates();
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
					class="mt-1 text-xs text-faint"
					data-testid="intro-network-verdict"
					data-state={candidates}
				>
					{#if candidates === 'checking'}
						{$_('intro.check.checking')}
					{:else if candidates === 'ok'}
						{$_('intro.check.ok')}
					{:else}
						{$_('intro.check.none')}
					{/if}
				</p>
				{#if candidates === 'none'}
					<p class="mt-1 text-xs text-faint">{$_('intro.check.sameNetwork')}</p>
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
