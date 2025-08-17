<script>
	/* eslint-disable no-undef */
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	export let show = true;
	export let title =
		'Simple-Todo-Example v' +
		(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') +
		' [' +
		(typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev') +
		']';
	export let description = 'This is a web application that:';
	export let features = [
		'Does not store any cookies or perform any tracking',
		"Does not store any data in your browser's storage",
		"Stores data temporarily in your browser's memory only",
		'Does not use any application or database server for entered or personal data',
		'Connects to at least one relay server and other browser or mobile device directly for peer-to-peer communication',
		'The relay server may cache your entered data, making it visible to other users in the internet',
		'For decentralization purposes, this web app is hosted on the IPFS network'
	];
	export let checkboxes = {
		relayConnection: {
			label:
				'I understand that this todo application is a demo app and will connect to a relay node and other browser or mobile devices directly running this app',
			checked: false
		},
		dataVisibility: {
			label:
				'I understand that the relay may store the entered data, making it visible to other users',
			checked: false
		},
		globalDatabase: {
			label:
				'I understand that this todo application works with one global unencrypted database which is visible to others testing this app simultaneously',
			checked: false
		},
		replicationTesting: {
			label:
				'I understand that I need to open a second browser or mobile device with the same web address to test the replication functionality',
			checked: false
		}
	};
	export let proceedButtonText = 'Continue';
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
				<h1 class="mb-6 text-center text-2xl font-bold text-gray-800">{title}</h1>
				<h3 class="mt-1 text-center text-sm text-gray-500">
					v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'} [{typeof __BUILD_DATE__ !==
					'undefined'
						? __BUILD_DATE__
						: 'dev'}]
				</h3>

				<div class="mb-6 space-y-4">
					<p class="text-gray-700">{description}</p>
					<ul class="ml-4 list-inside list-disc space-y-2 text-gray-700">
						{#each features as feature, index (index)}
							<li>{feature}</li>
						{/each}
					</ul>
				</div>

				<div class="mb-6 space-y-4">
					<p class="font-medium text-gray-700">Please confirm by checking the following boxes:</p>

					{#each Object.entries(checkboxes) as [key, item] (key)}
						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="checkbox"
								checked={item.checked}
								on:click={(e) => {
									const target = e.target;
									if (target && target instanceof HTMLInputElement) {
										handleCheckboxChange(key, target.checked);
									}
								}}
								class="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
							/>
							<span class="text-gray-700">{item.label}</span>
						</label>
					{/each}
				</div>

				<!-- NEW: Remember decision -->
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
						disabled={!allCheckboxesChecked}
						class="rounded-md bg-blue-500 px-6 py-3 font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:hover:bg-gray-300"
					>
						{allCheckboxesChecked ? proceedButtonText : disabledButtonText}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
