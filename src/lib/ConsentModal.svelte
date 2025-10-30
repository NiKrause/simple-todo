<script>
	/* eslint-disable no-undef */
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();

	export let show = true;

	// Storage preference toggle
	export let enablePersistentStorage = true;

	// Network connection toggle
	export let enableNetworkConnection = true;

	// Peer connection toggle (only relevant when network is enabled)
	export let enablePeerConnections = true;

	export let proceedButtonText = 'Accept & Continue';
	export let rememberLabel = "Don't show this again";
	export let rememberDecision = false;

	const handleProceed = () => {
		show = false;
		dispatch('proceed', {
			enablePersistentStorage,
			enableNetworkConnection,
			enablePeerConnections
		});
	};
</script>

{#if show}
	<!-- Compact Cookie-Style Consent Banner -->
	<div
		class="fixed right-0 bottom-0 left-0 z-50 border-t border-gray-300 bg-gradient-to-r from-blue-50 to-indigo-50 shadow-lg"
		data-testid="consent-modal"
	>
		<div class="mx-auto max-w-7xl px-4 py-3">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<!-- Left Side: Logo & Settings -->
				<div class="flex items-center gap-4">
					<!-- Logo -->
					<img src="/favicon.svg" alt="Simple TODO" class="h-8 w-8 flex-shrink-0" />

					<!-- Toggles in horizontal row -->
					<div class="flex items-center gap-4">
						<!-- Storage Toggle -->
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium text-gray-700">Storage:</span>
							<button
								on:click={() => (enablePersistentStorage = !enablePersistentStorage)}
								aria-label="Toggle browser storage"
								class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none {enablePersistentStorage
									? 'bg-blue-600'
									: 'bg-gray-400'}"
							>
								<span
									class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {enablePersistentStorage
										? 'translate-x-6'
										: 'translate-x-1'}"
								></span>
							</button>
							<span class="text-xs text-gray-600">
								{enablePersistentStorage ? 'On' : 'Off'}
							</span>
						</div>

						<!-- Network Toggle -->
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium text-gray-700">Network:</span>
							<button
								on:click={() => (enableNetworkConnection = !enableNetworkConnection)}
								aria-label="Toggle network connection"
								class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none {enableNetworkConnection
									? 'bg-blue-600'
									: 'bg-gray-400'}"
							>
								<span
									class="inline-block h-4 w-4 transform rounded-full bg-white transition-transform {enableNetworkConnection
										? 'translate-x-6'
										: 'translate-x-1'}"
								></span>
							</button>
							<span class="text-xs text-gray-600">
								{enableNetworkConnection ? 'On' : 'Off'}
							</span>
						</div>

						<!-- Peer Connection Checkbox (shown when relay node is enabled) -->
						{#if enableNetworkConnection}
							<div class="flex items-center gap-2">
								<input
									type="checkbox"
									id="peer-connections"
									bind:checked={enablePeerConnections}
									class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
								/>
								<label for="peer-connections" class="cursor-pointer text-xs text-gray-700">
									P2P Devices
								</label>
							</div>
						{/if}
					</div>
				</div>

				<!-- Right Side: Actions -->
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
					<!-- Description Text -->
					<div class="text-xs text-gray-600">
						{#if enablePersistentStorage && enableNetworkConnection}
							Local-first with P2P sync
						{:else if enablePersistentStorage}
							Local storage only (offline)
						{:else if enableNetworkConnection}
							Network only (relay may cache data)
						{:else}
							Memory only (no persistence)
						{/if}
						<span class="ml-2 text-gray-500">
							v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'}
							[{typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : 'dev'}]
						</span>
					</div>

					<div class="flex items-center gap-2">
						<label class="flex cursor-pointer items-center gap-1.5">
							<input
								type="checkbox"
								bind:checked={rememberDecision}
								class="h-4 w-4 rounded text-blue-600 focus:ring-blue-500"
							/>
							<span class="text-xs text-gray-700">{rememberLabel}</span>
						</label>
						<button
							on:click={handleProceed}
							class="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:outline-none"
						>
							{proceedButtonText}
						</button>
					</div>
				</div>
			</div>
		</div>
	</div>
{/if}
