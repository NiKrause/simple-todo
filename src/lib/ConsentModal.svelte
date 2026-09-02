<script>
	import { createEventDispatcher, onMount } from 'svelte';
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
	export let title = 'Simple-Todo';
	export let version = `${fallbackVersions} [${fallbackBuildDate}]`;
	export let description = 'Before joining this local-first P2P demo, please note:';
	/**
	 * What somebody is told, before they can be asked to agree to it.
	 *
	 * Two of these are about relays and appear only when the relay box is ticked:
	 * telling somebody their browser connects to relay nodes, in an app they have
	 * just left the relay switched off in, is describing a different app.
	 *
	 * Gone: "Todos are local-first ... through Helia, OrbitDB, and libp2p". The
	 * storage choice below already draws that distinction, and draws it as a
	 * decision rather than as a sentence.
	 */
	export let features = [
		'No tracking cookies are used. If you choose "remember this device", only that consent choice is saved locally.',
		// "No servers" is true and incomplete, which is worse than either. We run
		// none - and this page still arrives through somebody's, because a public
		// gateway is a server and it sees that you loaded it. Both halves, and the
		// two ways out of the second one.
		'We run no server, and no copy of your list exists anywhere we control.',
		'The app itself is delivered through a public IPFS gateway, which sees that you loaded it. Running your own Kubo node, or the IPFS Companion extension, fetches it from the network instead - nobody in the middle, and it keeps working if a gateway is down.'
	];

	/** Shown only with the relay box ticked, because only then are they true. */
	export let relayFeatures = [
		'The browser connects to relay/bootstrap nodes and other peers for discovery, connectivity, and replication.',
		'Relay or peer nodes may cache, pin, or replicate demo todo data so collaborators can sync - so another device can collect it after this one goes offline.'
	];
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
	export let warningHeading = 'Early days';
	export let warningBody =
		'This is a working demonstration rather than a finished product. It does what it says, and the format may still change - so keep anything you would be sorry to lose somewhere else as well.';
	export let acceptLabel = 'I have read this and accept it';
	export let accepted = false;
	export let proceedButtonText = 'Start P2P Demo';
	export let disabledButtonText = 'Please accept to continue';

	export let rememberDecision = false;
	export let rememberLabel = "Don't show this again on this device";

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
	export let storageMemoryLabel = 'In Memory Only';
	export let storageMemoryHint =
		'Todos are stored in a shared, unencrypted OrbitDB database in memory and will be deleted on app reload or on exit.';
	export let storagePersistentLabel = 'IndexedDB';
	export let storagePersistentHint =
		"I understand todos are stored in a shared, unencrypted OrbitDB database in the browser's IndexedDB and will persist between app restarts or after app exit.";

	export let relayNetworkEnabled = true;
	export let relayNetworkLabel = 'Connect to the public libp2p relay network';
	export let relayNetworkHint =
		'On: peers find each other automatically through public relay and bootstrap nodes. Off: this browser connects only to peers you invite yourself with a QR code or a copied invite — nothing announces you, and nobody can find you.';

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
			'We run no server, and no copy of your list exists anywhere we control.',
			'The app itself is delivered through a public IPFS gateway, which sees that you loaded it. Your own Kubo node, or the IPFS Companion extension, fetches it from the network instead.',
			state.relay
				? 'Relay and bootstrap nodes introduce peers to each other, and may cache or replicate this demo data so another device can collect it later.'
				: 'No relay is contacted. Without one, the other device has to be reachable from this network.',
			state.persistent
				? 'Your todos are kept in this browser and survive a restart, in a shared and unencrypted database.'
				: 'Your todos live in memory only and are gone when this page reloads. The database is shared and unencrypted either way.'
		].filter(Boolean);

	$: strings = {
		title,
		close: proceedButtonText,
		dontShow: rememberLabel
	};

	$: if (ready) introEl.strings = strings;
	$: if (ready) introEl.technical = technical;
	$: if (ready) {
		introEl.privacy = { accept: true, clauses };
		watchAcceptance();
	}
	$: if (ready)
		introEl.choices = { relay: relayNetworkEnabled, persistent: persistentStorageEnabled };
	$: if (ready && show && !introEl.isOpen) void introEl.open();

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
		introEl.addEventListener('close', (/** @type {any} */ event) => {
			rememberDecision = event.detail?.remember === true;
			show = false;
			dispatch('proceed');
		});
		ready = true;
	});
</script>

<qr-intro bind:this={introEl} data-testid="consent-modal">
	<button
		slot="header"
		type="button"
		on:click={() => (technical = !technical)}
		data-testid="consent-technical"
		class="rounded-md border border-border px-2 py-1 text-xs text-faint hover:text-text"
	>
		{technical ? 'Simple' : 'Technical'}
	</button>

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
		<strong class="text-text">{warningHeading}</strong>
		{warningBody}
	</p>

	<p class="mb-2">{description}</p>
	<ul class="mb-4 ml-4 list-outside list-disc space-y-1">
		{#each features as feature, index (index)}
			<li>{feature}</li>
		{/each}
		{#if relayNetworkEnabled}
			{#each relayFeatures as feature, index (index)}
				<li data-testid="consent-relay-feature">{feature}</li>
			{/each}
		{/if}
	</ul>

	<!--
		The storage choice, first among the decisions: it is the only one here that
		changes what the app does rather than what has been read. Two radios rather
		than one checkbox, because both sides carry a consequence worth stating and
		a lone checkbox can spell out only one of them.
	-->
	<fieldset class="mb-4 rounded-md border border-border p-3">
		<legend class="px-1 text-xs font-medium text-heading">Where your todos are stored</legend>
		<label class="flex cursor-pointer items-start gap-2 text-sm">
			<input
				type="radio"
				bind:group={persistentStorageEnabled}
				value={false}
				data-testid="consent-storage-memory"
				class="mt-1"
			/>
			<span>
				<span class="text-text">{storageMemoryLabel}</span>
				<span class="mt-0.5 block text-xs text-faint">{storageMemoryHint}</span>
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
				<span class="text-text">{storagePersistentLabel}</span>
				<span class="mt-0.5 block text-xs text-faint">{storagePersistentHint}</span>
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
			<span class="text-text">{relayNetworkLabel}</span>
			<span class="mt-0.5 block text-xs text-faint">{relayNetworkHint}</span>
		</span>
	</label>

	<button
		slot="footer"
		type="button"
		disabled={!accepted}
		on:click={() => introEl.close()}
		data-testid="consent-proceed"
		title={accepted ? undefined : acceptLabel}
		class="rounded-md bg-coral-500 px-6 py-3 font-medium text-white transition-colors hover:bg-coral-600 disabled:cursor-not-allowed disabled:opacity-50"
	>
		{accepted ? proceedButtonText : disabledButtonText}
	</button>
</qr-intro>
