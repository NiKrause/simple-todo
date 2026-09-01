<script>
	import { createEventDispatcher } from 'svelte';
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
		// Nothing is processed on our servers - and the honest half of that, which
		// went unsaid until now: a relay does hold data briefly, which is the whole
		// point of having one.
		'Nothing you write is processed on our servers. There is no account and no copy of your list anywhere we control.',
		'The app may be served through IPFS/IPNS or an HTTP gateway, depending on how you open it - including your own Kubo node or the IPFS Companion extension.'
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

	const handleProceed = () => {
		if (accepted) {
			show = false;
			dispatch('proceed');
		}
	};
</script>

{#if show}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
		<div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-surface shadow-xl">
			<div class="p-6">
				<h1 class="text-center text-2xl font-bold text-heading">{title}</h1>
				{#if version}
					<p class="mt-2 text-center text-sm text-faint">{version}</p>
				{/if}

				<div class="mb-6 space-y-4">
					<p class="text-text">{description}</p>
					<ul class="ml-4 list-inside list-disc space-y-2 text-text">
						{#each features as feature, index (index)}
							<li>{feature}</li>
						{/each}
						<!--
							Only with the relay switched on. Telling somebody their browser
							connects to relay nodes, in an app they have just switched the
							relay off in, describes a different app than the one they chose.
						-->
						{#if relayNetworkEnabled}
							{#each relayFeatures as feature, index (index)}
								<li data-testid="consent-relay-feature">{feature}</li>
							{/each}
						{/if}
					</ul>
				</div>

				<!--
					First, because it is the only decision here that changes what the app
					does rather than what the user has read — and because the option a
					person lands on should be the one they actively picked.

					Two radios rather than a single on/off: both sides carry a consequence
					worth stating ("deleted on reload" against "persists after exit"), and
					a lone checkbox can only ever spell out one of them.
				-->
				<fieldset class="mb-6 rounded-lg border border-border p-4">
					<legend class="px-1 text-sm font-medium text-text">Where your todos are stored</legend>
					<div class="grid gap-3 sm:grid-cols-2">
						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="radio"
								value={false}
								bind:group={persistentStorageEnabled}
								data-testid="consent-storage-memory"
								class="mt-1 h-4 w-4 shrink-0 text-cyan-600 focus:ring-cyan-500"
							/>
							<span>
								<span class="text-text">{storageMemoryLabel}</span>
								<span class="mt-1 block text-sm text-faint">{storageMemoryHint}</span>
							</span>
						</label>
						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="radio"
								value={true}
								bind:group={persistentStorageEnabled}
								data-testid="consent-storage-indexeddb"
								class="mt-1 h-4 w-4 shrink-0 text-cyan-600 focus:ring-cyan-500"
							/>
							<span>
								<span class="text-text">{storagePersistentLabel}</span>
								<span class="mt-1 block text-sm text-faint">{storagePersistentHint}</span>
							</span>
						</label>
					</div>
				</fieldset>

				<!--
					The relay switch, back where it was. It is a choice about what the app
					does, so it sits above the gate rather than among the things being
					accepted - and the two relay sentences in the notice appear with it.
				-->
				<div class="mt-6 border-t border-border pt-4">
					<label class="flex cursor-pointer items-start space-x-3">
						<input
							type="checkbox"
							bind:checked={relayNetworkEnabled}
							data-testid="consent-relay-network"
							class="mt-1 h-4 w-4 rounded text-cyan-600 focus:ring-cyan-500"
						/>
						<span>
							<span class="text-text">{relayNetworkLabel}</span>
							<span class="mt-1 block text-sm text-faint">{relayNetworkHint}</span>
						</span>
					</label>
				</div>

				<div class="mt-4 border-t border-border pt-4">
					<label class="flex cursor-pointer items-start space-x-3">
						<input
							type="checkbox"
							bind:checked={rememberDecision}
							data-testid="consent-remember"
							class="mt-1 h-4 w-4 rounded text-cyan-600 focus:ring-cyan-500"
						/>
						<span class="text-text">{rememberLabel}</span>
					</label>
				</div>

				<div class="mt-6 border-t border-border pt-4">
					<label class="flex cursor-pointer items-start space-x-3">
						<input
							type="checkbox"
							bind:checked={accepted}
							data-testid="consent-accept"
							class="mt-1 h-4 w-4 rounded text-cyan-600 focus:ring-cyan-500"
						/>
						<span class="text-text">{acceptLabel}</span>
					</label>
				</div>

				<div class="mt-6 flex justify-center">
					<button
						on:click={handleProceed}
						disabled={!accepted}
						class="rounded-md bg-coral-500 px-6 py-3 font-medium text-white transition-colors hover:bg-coral-600 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:hover:bg-surface-2"
					>
						{accepted ? proceedButtonText : disabledButtonText}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
