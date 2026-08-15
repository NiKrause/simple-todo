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
	export let features = [
		'No tracking cookies are used. If you choose "remember this device", only that consent choice is saved locally.',
		'Todos are local-first in your browser session and synchronize through Helia, OrbitDB, and libp2p.',
		'The browser connects to relay/bootstrap nodes and other peers for discovery, connectivity, and replication.',
		'Relay or peer nodes may cache, pin, or replicate demo todo data so collaborators can sync.',
		'The demo uses a shared, unencrypted OrbitDB database. Do not enter private or sensitive data.',
		'The app may be served through IPFS/IPNS or an HTTP gateway, depending on how you open it.'
	];
	/** @type {{
	 *   relayConnection: { label: string, checked: boolean },
	 *   dataVisibility: { label: string, checked: boolean },
	 *   replicationTesting: { label: string, checked: boolean }
	 * }} */
	export let checkboxes = {
		relayConnection: {
			label:
				'I understand this app uses libp2p peer-to-peer networking and may connect to relay/bootstrap nodes and other peers.',
			checked: false
		},
		dataVisibility: {
			label: 'I understand relay or peer nodes may cache, pin, or replicate demo todo data.',
			checked: false
		},
		replicationTesting: {
			label:
				'I understand collaboration requires another browser or device using the same app and database address.',
			checked: false
		}
	};
	export let confirmationLabel = 'Please confirm:';
	export let proceedButtonText = 'Start P2P Demo';
	export let disabledButtonText = 'Please check all boxes to continue';

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

	$: allCheckboxesChecked = Object.values(checkboxes).every((item) => item.checked);

	const handleProceed = () => {
		if (allCheckboxesChecked) {
			show = false;
			dispatch('proceed');
		}
	};

	/**
	 * @param {'relayConnection' | 'dataVisibility' | 'replicationTesting'} key
	 * @param {boolean} checked
	 */
	const handleCheckboxChange = (key, checked) => {
		if (checkboxes[key]) {
			checkboxes[key].checked = checked;
			checkboxes = { ...checkboxes };
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

				<div class="mb-6 space-y-4">
					<p class="font-medium text-text">{confirmationLabel}</p>

					{#each Object.entries(checkboxes) as [key, item] (key)}
						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="checkbox"
								checked={item.checked}
								on:click={(e) => {
									const target = e.target;
									if (target && target instanceof HTMLInputElement) {
										handleCheckboxChange(
											/** @type {'relayConnection' | 'dataVisibility' | 'replicationTesting'} */ (
												key
											),
											target.checked
										);
									}
								}}
								class="mt-1 h-4 w-4 rounded text-cyan-600 focus:ring-cyan-500"
							/>
							<span class="text-text">{item.label}</span>
						</label>
					{/each}
				</div>

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

				<div class="mt-6 flex justify-center">
					<button
						on:click={handleProceed}
						disabled={!allCheckboxesChecked}
						class="rounded-md bg-coral-500 px-6 py-3 font-medium text-white transition-colors hover:bg-coral-600 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:hover:bg-surface-2"
					>
						{allCheckboxesChecked ? proceedButtonText : disabledButtonText}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
