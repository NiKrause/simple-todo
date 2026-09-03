<script>
	import { createEventDispatcher, onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { _ } from '$lib/i18n/index.js';
	import LanguageSwitcher from './LanguageSwitcher.svelte';
	import { formatBuildDate, formatVersions } from './build-info.js';

	const dispatch = createEventDispatcher();
	// No app name in front of the version here: `title` already renders it
	// directly above this line. The stack versions follow the app's own, the
	// same way the page header states them, so the dependencies this screen
	// asks the reader to consent to are named with the numbers that shipped.
	const fallbackVersions = formatVersions();
	const fallbackBuildDate = formatBuildDate(
		typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''
	);

	export let show = true;
	export let version = `${fallbackVersions} [${fallbackBuildDate}]`;
	/**
	 * The notice list is gone, and it was said twice.
	 *
	 * "Before joining this demo, please note:" introduced three bullets, and the
	 * privacy panel beside them said the same three things — one of them almost
	 * word for word. Two relay bullets appeared with the relay box, next to a
	 * clause that already followed that box. Somebody reading carefully got the
	 * same page twice and had to work out whether the two versions differed.
	 *
	 * They now exist once, in the statement that is actually being consented to,
	 * which is the copy that has to be right. What did *not* exist there is the
	 * sentence about cookies — so that one moved rather than being dropped, and
	 * it goes last: it is the only line that is about this dialog rather than
	 * about the app.
	 *
	 * `description`, `features` and `relayFeatures` were props. Removing them is
	 * a breaking change to a component with exactly one caller, in this repo.
	 */
	/**
	 * One gate, not three acknowledgements.
	 *
	 * The three that were here confirmed sentences this dialog had just
	 * asserted - that it uses libp2p, that relays may cache, that collaboration
	 * needs a second device. A tick against a line somebody has just read
	 * confirms that they can read.
	 *
	 * What remains is a single one, and it accepts the notice above. It becomes
	 * the accept for the assembled privacy statement once this modal moves onto
	 * the shared element - the point of assembling one is that what is consented
	 * to is what was configured.
	 */
	export let accepted = false;
	export let rememberDecision = false;

	/**
	 * A choice, not an acknowledgement — which is why it sits outside
	 * `checkboxes` and never blocks the proceed button. Unticking it is a valid
	 * way to continue, not a refusal to consent.
	 */
	/**
	 * Where the todos live. A choice, like `relayNetworkEnabled`, so it sits
	 * outside `checkboxes` and never blocks the proceed button.
	 *
	 * It replaces the old "shared, unencrypted OrbitDB database" acknowledgement
	 * rather than sitting next to it: both sides of the switch state that fact,
	 * so picking either one is the acknowledgement. Nobody can choose without
	 * reading it.
	 */
	export let persistentStorageEnabled = false;
	export let relayNetworkEnabled = true;

	/**
	 * The dialog is `qr-intro` now, not markup of our own.
	 *
	 * What moved: the shell, the network measurement, the technical view, the
	 * "don't show again" tick and the privacy panel with its gate. What stayed
	 * here is what belongs to this app - the storage choice, the relay switch and
	 * the notice itself, all of it in the story slot.
	 *
	 * The relay switch is deliberately still ours rather than the element's. Its
	 * value decides how the libp2p node is built, is read before the node starts
	 * and is persisted by the page; handing that to the element would be a second
	 * rewiring in the same change, with the node's configuration as the thing at
	 * risk.
	 */
	/** @type {any} */
	let introEl;
	let ready = false;
	let technical = false;

	/**
	 * What the notice means for somebody's data, assembled from what they chose.
	 *
	 * Ours rather than the element's: what this app does with data is this app's
	 * to state. Read at call time, so the element's repaint is what refreshes
	 * them rather than a rebuilt closure.
	 */
	const clauses = (/** @type {any} */ state) =>
		[
			get(_)('consent.clause.noServer'),
			get(_)('consent.clause.gateway'),
			state.relay ? get(_)('consent.clause.relayOn') : get(_)('consent.clause.relayOff'),
			state.persistent ? get(_)('consent.clause.persistent') : get(_)('consent.clause.memory'),
			// Last, and the only line here about this dialog rather than about the
			// app. It used to head the notice above; the notice is gone and this is
			// the one sentence it carried that the statement did not.
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
	$: if (ready) {
		introEl.choices = { relay: relayNetworkEnabled, persistent: persistentStorageEnabled };
		// After the assignment, not before: `set choices` repaints the panel
		// synchronously, so by this line the new clauses are in the DOM.
		markChangedClauses();
	}
	$: if (ready && show && !introEl.isOpen) void introEl.open();

	/**
	 * The statement as it was last painted, so a choice can be told from a
	 * repaint.
	 */
	/** @type {string[]} */
	let paintedClauses = [];

	/**
	 * Flash the lines a choice just rewrote.
	 *
	 * The panel is the point of assembling a statement — it says what *this*
	 * configuration means — and a switch three inches away silently rewrote two
	 * of its sentences. Somebody who ticks the relay box has no way to know
	 * which line moved unless they had memorised the paragraph.
	 *
	 * Compared by text rather than by index alone: the list is rebuilt whole on
	 * every repaint (`replaceChildren`), and the clause at position 2 is a
	 * different sentence depending on the relay, not a different clause.
	 *
	 * Nothing is marked on the first paint. Everything is new then, and flashing
	 * the whole statement on arrival teaches nobody which line their choice
	 * moved — it just makes the dialog shout when it opens.
	 */
	function markChangedClauses() {
		const list = introEl?.shadowRoot?.querySelector('.privacy ul');
		if (!list) return;

		const next = [...list.children].map((item) => item.textContent ?? '');
		if (paintedClauses.length > 0) {
			next.forEach((text, index) => {
				if (text !== paintedClauses[index]) list.children[index]?.classList.add('changed');
			});
		}
		paintedClauses = next;
	}

	/**
	 * The animation, inside the shadow root because that is where the clauses
	 * live.
	 *
	 * A `part` on each clause would be the clean way and the element does not
	 * offer one; appending a stylesheet is the reach that avoids forking it, and
	 * it survives repaints because only the `<ul>`'s children are replaced.
	 *
	 * The colour comes from a custom property set on the host below, so it
	 * follows the app's theme — custom properties cross the shadow boundary and
	 * a hard-coded yellow would be invisible on one of the two backgrounds.
	 *
	 * Reduced motion gets the same signal without the blink: the point is to
	 * show *which* line changed, and a static tint says that just as well.
	 */
	const HIGHLIGHT_STYLE = `
		.privacy li.changed {
			border-radius: 0.2rem;
			animation: consent-changed 900ms ease-in-out 2;
		}
		@keyframes consent-changed {
			0%, 100% { background: transparent; }
			50% { background: var(--consent-changed); }
		}
		@media (prefers-reduced-motion: reduce) {
			.privacy li.changed {
				animation: none;
				background: var(--consent-changed);
			}
		}
	`;

	/**
	 * The element disables its own close control - the cross in the corner. The
	 * proceed button below is ours, and looked ready while `close()` declined.
	 * Idempotent, because the reactive block above runs again on every choice.
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

		// A plain style element rather than `adoptedStyleSheets`: one line, no
		// feature detection, and nothing else writes to the shadow root's
		// children apart from the element itself.
		//
		// The tag name is not spelled out anywhere in this block on purpose.
		// Svelte's parser scans the script for a literal style tag and takes one
		// inside a comment for the real thing — it reported `<script> was left
		// open` against the closing tag ninety lines further down, which points
		// at everything except the comment that caused it.
		const highlight = document.createElement('style');
		highlight.textContent = HIGHLIGHT_STYLE;
		introEl.shadowRoot?.append(highlight);

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
		The language switch lives in here, next to the view switch, rather than in
		the page header: this dialog is the first thing anybody sees, and sending
		somebody to the header to change the language of the screen they are
		currently failing to read would be a poor joke.
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

	{#if version}
		<p class="mb-3 text-xs text-faint">{version}</p>
	{/if}

	<!--
		First, and quietly. It is a demonstration and saying so is fair - but a
		warning that frightens people off is not a warning, it is a door.
	-->
	<p
		class="mb-4 rounded-md border border-border px-3 py-2 text-sm text-faint"
		data-testid="consent-warning"
	>
		<strong class="text-text">{$_('consent.warningHeading')}</strong>
		{$_('consent.warningBody')}
	</p>

	<!--
		The storage choice, first among the decisions: it is the only one here that
		changes what the app does rather than what has been read. Two radios rather
		than one checkbox, because both sides carry a consequence worth stating and
		a lone checkbox can spell out only one of them.
	-->
	<fieldset class="mb-4 rounded-md border border-border p-3">
		<legend class="px-1 text-xs font-medium text-heading">{$_('consent.storageLegend')}</legend>
		<label class="flex cursor-pointer items-start gap-2 text-sm">
			<input
				type="radio"
				bind:group={persistentStorageEnabled}
				value={false}
				data-testid="consent-storage-memory"
				class="mt-1"
			/>
			<span>
				<span class="text-text">{$_('consent.storageMemoryLabel')}</span>
				<span class="mt-0.5 block text-xs text-faint">{$_('consent.storageMemoryHint')}</span>
			</span>
		</label>
		<label class="mt-2 flex cursor-pointer items-start gap-2 text-sm">
			<input
				type="radio"
				bind:group={persistentStorageEnabled}
				value={true}
				data-testid="consent-storage-indexeddb"
				class="mt-1"
			/>
			<span>
				<span class="text-text">{$_('consent.storagePersistentLabel')}</span>
				<span class="mt-0.5 block text-xs text-faint">{$_('consent.storagePersistentHint')}</span>
			</span>
		</label>
	</fieldset>

	<label class="flex cursor-pointer items-start gap-2 text-sm">
		<input
			type="checkbox"
			bind:checked={relayNetworkEnabled}
			data-testid="consent-relay-network"
			class="mt-1"
		/>
		<span>
			<span class="text-text">{$_('consent.relayLabel')}</span>
			<span class="mt-0.5 block text-xs text-faint">{$_('consent.relayHint')}</span>
		</span>
	</label>

	<button
		slot="footer"
		type="button"
		disabled={!accepted}
		on:click={() => introEl.close()}
		data-testid="consent-proceed"
		title={accepted ? undefined : $_('consent.accept')}
		class="rounded-md bg-coral-500 px-6 py-3 font-medium text-white transition-colors hover:bg-coral-600 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{accepted ? $_('consent.proceed') : $_('consent.proceedDisabled')}
	</button>
</qr-intro>

<style>
	/*
		The flash colour, on the host, so it crosses into the shadow root where
		the clauses are — and so it can differ by theme, which a hard-coded value
		inside `HIGHLIGHT_STYLE` could not.

		Yellow in the dark, where it is the colour a highlighter would be. Amber
		in the light, because the same yellow on a white panel is barely a change
		at all — the signal has to survive both backgrounds, and matching the
		hue matters less than being seen.
	*/
	/*
		The element's own palette, taken from the app's.

		Without this it themes itself from `prefers-color-scheme` and ignores the
		app entirely — so the dialog stayed dark while the page around it was
		light, and the highlight below had a light variant nobody could ever see.
		`qr01` has passed these since its intro landed; `main` never did, which is
		why the two chapters' dialogs did not look alike.

		These are the same tokens `.dark` redefines in `app.css`, so the dialog
		follows the theme toggle rather than the operating system.
	*/
	qr-intro {
		--qr-intro-background: var(--surface);
		--qr-intro-color: var(--text);
		--qr-intro-border: var(--border);
		--qr-intro-muted: var(--faint);
		--qr-intro-accent: var(--cyan);

		--consent-changed: rgba(217, 119, 6, 0.3);
	}

	:global(html.dark) qr-intro {
		--consent-changed: rgba(250, 204, 21, 0.4);
	}
</style>
