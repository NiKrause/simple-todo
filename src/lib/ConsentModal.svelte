<script>
	/* eslint-disable no-undef */
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();
	const fallbackVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
	const fallbackBuildDate = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev';

	export let show = true;
	export let title = 'Simple TODO Example';
	export let version = `v${fallbackVersion} [${fallbackBuildDate}]`;
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
	 *   globalDatabase: { label: string, checked: boolean },
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
		globalDatabase: {
			label:
				'I understand todos are stored in a shared, unencrypted OrbitDB database and should not contain private data.',
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
	export let canProceed = true;

	export let rememberDecision = false;
	export let rememberLabel = "Don't show this again on this device";

	$: allCheckboxesChecked = Object.values(checkboxes).every((item) => item.checked);
	$: readyToProceed = allCheckboxesChecked && canProceed;

	const handleProceed = () => {
		if (readyToProceed) {
			show = false;
			dispatch('proceed');
		}
	};

	/**
	 * @param {'relayConnection' | 'dataVisibility' | 'globalDatabase' | 'replicationTesting'} key
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
	<div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black p-4">
		<div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-xl">
			<div class="p-6">
				<h1 class="text-center text-2xl font-bold text-gray-800">{title}</h1>
				{#if version}
					<p class="mt-2 text-center text-sm text-gray-500">{version}</p>
				{/if}

				<div class="mb-6 space-y-4">
					<p class="text-gray-700">{description}</p>
					<ul class="ml-4 list-inside list-disc space-y-2 text-gray-700">
						{#each features as feature, index (index)}
							<li>{feature}</li>
						{/each}
					</ul>
				</div>

				<slot name="before-confirmation" />

				<div class="mb-6 space-y-4">
					<p class="font-medium text-gray-700">{confirmationLabel}</p>

					{#each Object.entries(checkboxes) as [key, item] (key)}
						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="checkbox"
								checked={item.checked}
								on:click={(e) => {
									const target = e.target;
									if (target && target instanceof HTMLInputElement) {
										handleCheckboxChange(
											/** @type {'relayConnection' | 'dataVisibility' | 'globalDatabase' | 'replicationTesting'} */ (
												key
											),
											target.checked
										);
									}
								}}
								class="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
							/>
							<span class="text-gray-700">{item.label}</span>
						</label>
					{/each}
				</div>

				<div class="mt-6 border-t border-gray-200 pt-4">
					<label class="flex cursor-pointer items-start space-x-3">
						<input
							type="checkbox"
							bind:checked={rememberDecision}
							class="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
						/>
						<span class="text-gray-700">{rememberLabel}</span>
					</label>
				</div>

				<div class="mt-6 flex justify-center">
					<button
						on:click={handleProceed}
						disabled={!readyToProceed}
						class="rounded-md bg-blue-500 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:hover:bg-gray-300"
					>
						{readyToProceed ? proceedButtonText : disabledButtonText}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
