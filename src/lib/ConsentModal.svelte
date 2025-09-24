<script>
	/* eslint-disable no-undef */
	import { createEventDispatcher } from 'svelte';
	import { Shield, Database, Globe, Server } from 'lucide-svelte';

	const dispatch = createEventDispatcher();

	export let show = true;
	export let title =
		'Simple-Todo-Example v' +
		(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') +
		' [' +
		(typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev') +
		']';
	export let description = 'This local-first & peer-to-peer web application:';
	export let features = [
		'Does not store any cookies or perform any tracking',
		'Does not use any application or database server for entered or personal data',
		'The relay server may cache your entered data, making it visible to other users',
		'Web app is hosted and available on the IPFS network, the traditional domain name webserver is only a proxied'
	];

	// Icon mapping for features
	const featureIcons = [
		{ icon: Shield, color: 'text-green-600' },
		{ icon: Database, color: 'text-blue-600' },
		{ icon: Server, color: 'text-orange-600' },
		{ icon: Globe, color: 'text-purple-600' }
	];

	// Storage preference toggle
	export let enablePersistentStorage = true;

	// Network connection toggle
	export let enableNetworkConnection = true;

	// Peer connection toggle (only relevant when network is enabled)
	export let enablePeerConnections = true;

	export let checkboxes = {
		storageUnderstanding: {
			label: 'I understand the data storage implications of my choice above',
			checked: false
		},
		networkUnderstanding: {
			label: 'I understand the network connection implications of my choice above',
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
	export let rememberLabel = "Don't show this again on this device";
	export let rememberDecision = false;

	// Reactive statement to check if both storage and network are disabled
	$: noDataAvailable = !enablePersistentStorage && !enableNetworkConnection;

	$: allCheckboxesChecked = Object.values(checkboxes).every((item) => item.checked);

	const handleProceed = () => {
		if (allCheckboxesChecked) {
			show = false;
			dispatch('proceed', {
				enablePersistentStorage,
				enableNetworkConnection,
				enablePeerConnections
			});
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
	<div
		class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black p-4"
		data-testid="consent-modal"
	>
		<div class="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-white shadow-xl">
			<div class="p-6">
				<h1 class="mb-6 text-center text-2xl font-bold text-gray-800">{title}</h1>
				<h3 class="mt-1 text-center text-sm text-gray-500">
					v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'} [{typeof __BUILD_DATE__ !==
					'undefined'
						? __BUILD_DATE__
						: 'dev'}]
				</h3>

				<!-- Data Storage and Network Connection Options -->
				<div class="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
					<!-- Data Storage Options -->
					<div class="space-y-4 rounded-lg border border-gray-200 p-4">
						<h3 class="font-medium text-gray-800">Data Storage Preference</h3>
						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="radio"
								bind:group={enablePersistentStorage}
								value={true}
								class="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
							/>
							<div class="text-gray-700">
								<div class="font-medium">Browser Storage (Default = Local-First)</div>
								<div class="text-sm text-gray-600">
									Stores data in your browser's storage in order to remember data between sessions
								</div>
							</div>
						</label>

						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="radio"
								bind:group={enablePersistentStorage}
								value={false}
								class="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
							/>
							<div class="text-gray-700">
								<div class="font-medium">Memory Only (No Local-First)</div>
								<div class="text-sm text-gray-600">
									Does NOT store any data in your browser's storage - data will be loaded from other
									peers if network is connected
								</div>
							</div>
						</label>
					</div>

					<!-- Network Connection Options -->
					<div class="space-y-4 rounded-lg border border-gray-200 p-4">
						<h3 class="font-medium text-gray-800">Network Connection Preference</h3>

						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="radio"
								bind:group={enableNetworkConnection}
								value={true}
								class="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
							/>
							<div class="text-gray-700">
								<div class="font-medium">Connect to a relay node (Default)</div>
								<div class="text-sm text-gray-600">
									Connects to relay node as a precondition for peer-to-peer communication with other
									browsers.
									<span class="font-medium text-orange-600"
										>The relay server may cache your entered data, making it visible to other users
										in the internet.</span
									>
								</div>
							</div>
						</label>
						<!-- Peer Connection Options (only shown when network is enabled) -->
						{#if enableNetworkConnection}
							<div class="mt-4 ml-6 space-y-3 border-l-2 border-blue-200 pl-4">
								<h4 class="text-sm font-medium text-gray-700">Peer Connection Settings</h4>

								<label class="flex cursor-pointer items-start space-x-3">
									<input
										type="checkbox"
										bind:checked={enablePeerConnections}
										class="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
									/>
									<div class="text-gray-700">
										<div class="text-sm font-medium">
											Connect to Other Browsers & Mobile Devices
										</div>
										<div class="text-xs text-gray-600">
											Allows direct peer-to-peer connections with other browsers and mobile devices
											for real-time data synchronization. Unchecking this will only connect to relay
											servers without establishing direct peer connections.
										</div>
									</div>
								</label>
							</div>
						{/if}

						<label class="flex cursor-pointer items-start space-x-3">
							<input
								type="radio"
								bind:group={enableNetworkConnection}
								value={false}
								class="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
							/>
							<div class="text-gray-700">
								<div class="font-medium">Offline Mode</div>
								<div class="text-sm text-gray-600">
									Does not connect to the network or relay node (and cannot connect to other
									browsers nor can replicate data between other users)
								</div>
							</div>
						</label>
					</div>
				</div>

				<!-- Warning when no data is available -->
				{#if noDataAvailable}
					<div class="mb-6 rounded-lg border-2 border-red-200 bg-red-50 p-4">
						<div class="flex items-start space-x-3">
							<div class="flex-shrink-0">
								<svg class="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
									<path
										fill-rule="evenodd"
										d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
										clip-rule="evenodd"
									/>
								</svg>
							</div>
							<div>
								<h3 class="text-sm font-medium text-red-800">
									No storage and no network connection
								</h3>
								<div class="mt-2 text-sm text-red-700">
									<p>
										With both browser storage disabled and network connection disabled, you will not
										be able to see any previously stored todo data nor any todo's replicated from
										other peers. The application will start empty and will not store permanently. It
										will not connect to other peers for peer-to-peer replications. Please enable
										either browser storage or network connection to use the application if that is
										not your intention.
										<br />
										E.g. If you only enabling browser storage now, you can continue working on your todo
										list in offline mode and synchronize it later with other peers!
										<br />
										If you disable browser storage and enable network connection the app will synchronize
										with other peers first before you can add any todos
									</p>
								</div>
							</div>
						</div>
					</div>
				{/if}
				<p class="text-gray-700">&nbsp;</p>
				<div class="mb-6 space-y-4">
					<p class="text-gray-700">{description}</p>
					<div class="flex flex-wrap items-center justify-center gap-4 rounded-lg bg-gray-50 p-4">
						{#each features as feature, index (index)}
							<div class="group relative">
								<div
									class="flex h-12 w-12 cursor-help items-center justify-center rounded-full bg-white shadow-md transition-shadow hover:shadow-lg"
								>
									<svelte:component
										this={featureIcons[index].icon}
										class="h-6 w-6 {featureIcons[index].color}"
									/>
								</div>
								<!-- Tooltip -->
								<div
									class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 transform rounded-lg bg-gray-900 px-3 py-2 text-center text-sm text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100"
								>
									{feature}
									<!-- Arrow -->
									<div
										class="absolute top-full left-1/2 h-0 w-0 -translate-x-1/2 transform border-t-4 border-r-4 border-l-4 border-transparent border-t-gray-900"
									></div>
								</div>
							</div>
						{/each}
					</div>
				</div>
				<!-- Consent Checkboxes -->
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
								class="mt-1 h-4 w-4 rounded text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
							/>
							<span class="text-gray-700">{item.label}</span>
						</label>
					{/each}
				</div>

				<!-- Remember decision -->
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
						{proceedButtonText}
						<!-- {noDataAvailable ? 'Cannot proceed - no data available' : allCheckboxesChecked ? proceedButtonText : disabledButtonText} -->
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
