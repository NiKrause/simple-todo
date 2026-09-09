<script>
	import { createEventDispatcher, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { _ } from '$lib/i18n/index.js';
	import LanguageSwitcher from './LanguageSwitcher.svelte';
	import { formatBuildDate, formatVersions } from './build-info.js';

	const dispatch = createEventDispatcher();

	export let show = true;
	export let rememberDecision = false;
	/** Whether the app's own gate is satisfied — here, a valid mnemonic. */
	export let canProceed = true;
	/** @type {'anonymous' | 'create' | 'existing'} */
	export let identity = 'anonymous';
	/**
	 * What went wrong the last time somebody pressed proceed.
	 *
	 * It belongs here rather than on the page behind: the dialog reopens on
	 * every failure, so a message rendered in `<main>` is covered by the very
	 * dialog that is asking again. Somebody then sees the consent screen
	 * return with no explanation, which is how "existing passkey" looked like
	 * a dead button (#337).
	 *
	 * @type {string | null}
	 */
	export let error = null;

	/** @type {any} */
	let introEl;
	let ready = false;
	let technical = false;
	let accepted = false;

	const version = `${formatVersions()} [${formatBuildDate(
		typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''
	)}]`;

	/**
	 * The statement in plain words, assembled from what is actually configured.
	 *
	 * This is the "simple" half of the dialog; the element's technical view is
	 * the other, and it renders itself. Written for somebody who does not work
	 * in security and still has to decide something: what exists where, who can
	 * read it, and what cannot be undone. No stack names, no protocol names —
	 * those are one button away in the technical view for anyone who wants them.
	 *
	 * A function rather than a list, because two of these sentences depend on
	 * the identity chosen three inches above; the element re-reads them whenever
	 * `choices` changes.
	 *
	 * @param {any} state
	 */
	const clauses = (state) =>
		[
			get(_)('consent.clause.noServer'),
			get(_)('consent.clause.gateway'),
			get(_)('consent.clause.relay'),
			get(_)('consent.clause.sharedList'),
			get(_)('consent.clause.privateList'),
			get(_)('consent.clause.keyStaysHere'),
			get(_)('consent.clause.keyIsForever'),
			state.identity === 'anonymous'
				? get(_)('consent.clause.identityAnonymous')
				: get(_)('consent.clause.identityPasskey'),
			get(_)('consent.clause.reload'),
			get(_)('consent.clause.cookies')
		].filter(Boolean);

	$: strings = {
		title: $_('app.title'),
		close: $_('consent.proceed'),
		dontShow: $_('consent.remember')
	};

	$: if (ready) introEl.strings = strings;
	$: if (ready) introEl.technical = technical;
	$: if (ready) {
		introEl.privacy = { accept: true, clauses };
		watchAcceptance();
	}
	$: if (ready) introEl.choices = { identity };

	/*
		One label for two different blockers told people to fill in a field that
		was already filled: the mnemonic is generated and valid on arrival, so
		what actually holds the button is the acceptance tick further down.

		Named in reading order — the mnemonic sits above the tick, so an invalid
		one is what to say first.
	*/
	$: proceedLabel = !canProceed
		? $_('consent.proceedDisabled')
		: !accepted
			? $_('consent.proceedNeedsAccept')
			: $_('consent.proceed');
	$: if (ready && show && !introEl.isOpen) void introEl.open();

	/**
	 * The element disables its own close control; the proceed button below is
	 * ours and has to know whether the statement was accepted. Idempotent,
	 * because the reactive block above runs again on every choice.
	 */
	function watchAcceptance() {
		const box = introEl?.shadowRoot?.querySelector('input[part=accept]');
		if (!box || box.dataset.watched === 'true') return;
		box.dataset.watched = 'true';
		accepted = box.checked === true;
		box.addEventListener('change', () => (accepted = box.checked === true));
	}

	onMount(async () => {
		await import('@le-space/libp2p-webrtc-qr/elements');
		introEl.strings = strings;

		introEl.addEventListener('close', (/** @type {any} */ event) => {
			rememberDecision = event.detail?.remember === true;
			show = false;
			dispatch('proceed');
		});
		ready = true;
	});
</script>

<qr-intro bind:this={introEl} data-testid="consent-modal">
	<!--
		The language switch belongs in here rather than in the page header: this
		dialog is the first thing anybody sees, and sending somebody to the header
		to change the language of the screen they are currently failing to read
		would be a poor joke.
	-->
	<div slot="header" class="flex shrink-0 items-center gap-2">
		<LanguageSwitcher />
		<button
			type="button"
			on:click={() => (technical = !technical)}
			data-testid="consent-technical"
			class="rounded-md border border-border px-2 py-1 text-xs text-faint hover:text-text"
		>
			{technical ? $_('consent.simple') : $_('consent.technical')}
		</button>
	</div>

	<p class="text-xs text-faint">{version}</p>

	<div class="my-4 rounded-md border border-border p-3 text-sm" data-testid="consent-warning">
		<span class="font-medium text-heading">{$_('consent.warningHeading')}</span>
		<span class="text-text">{$_('consent.warningBody')}</span>
	</div>

	<!--
		The chapter's own controls: the shared-list mnemonic and the identity
		choice. They stay the app's markup in the element's story slot, which is
		the split the element is built around — it knows about dialogs, not about
		this app.
	-->
	<slot name="before-confirmation" />

	<div slot="footer" class="flex flex-col items-stretch gap-2 sm:items-end">
		{#if error}
			<p
				role="alert"
				data-testid="consent-error"
				class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
			>
				{error}
			</p>
		{/if}
		<button
			type="button"
			disabled={!accepted || !canProceed}
			on:click={() => introEl.close()}
			data-testid="consent-proceed"
			class="rounded-md bg-coral-700 px-6 py-3 font-medium text-white transition-colors hover:bg-coral-800 disabled:cursor-not-allowed disabled:opacity-50"
		>
			{proceedLabel}
		</button>
	</div>
</qr-intro>

<style>
	/*
		The element ships a dark-first palette and reads it from `--qr-intro-*`.
		Every name it does not find falls back to that dark default, and the
		fallback is silent — which is how `--qr-intro-text` (a name the element
		never reads; it is `--qr-intro-color`) left the dialog with #e8ecf3 text
		on the white `--surface` we did set: 1.18:1, with the identity choice as
		the casualty. So map the whole set, not the two that seemed to matter.

		Mapping to the app tokens rather than to literals also carries the dark
		theme for free: `.dark` redefines them on :root and the dialog follows.
	*/
	qr-intro {
		--qr-intro-background: var(--surface);
		--qr-intro-color: var(--text);
		--qr-intro-muted: var(--faint);
		--qr-intro-border: var(--border);
		--qr-intro-accent: var(--identity);
		--qr-intro-panel-background: var(--surface-2);
		--qr-intro-panel-border: var(--border);
		--qr-intro-panel-color: var(--text);
	}
</style>
