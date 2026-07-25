<script>
	/* eslint-disable no-undef */
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();
	const fallbackVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
	const fallbackBuildDate = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev';

	export let show = true;
	export let title = 'Simple-Todo';
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

	export let rememberDecision = false;
	export let rememberLabel = "Don't show this again on this device";

	$: allCheckboxesChecked = Object.values(checkboxes).every((item) => item.checked);

	const handleProceed = () => {
		if (allCheckboxesChecked) {
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
											/** @type {'relayConnection' | 'dataVisibility' | 'globalDatabase' | 'replicationTesting'} */ (
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
							bind:checked={rememberDecision}
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
