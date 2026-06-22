<script>
	import { createEventDispatcher } from 'svelte';
	import { webrtcEnabledStore, setWebRTCEnabled } from './webrtc-settings.js';

	export let disabled = false;

	const dispatch = createEventDispatcher();

	function toggleWebRTC() {
		if (disabled) return;

		const enabled = !$webrtcEnabledStore;
		setWebRTCEnabled(enabled);
		dispatch('change', { enabled });
	}
</script>

<div class="rounded-lg bg-white p-6 shadow-md" data-testid="webrtc-toggle-card">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-xl font-semibold text-gray-800">WebRTC</h2>
			<p class="mt-1 text-sm text-gray-500">
				{$webrtcEnabledStore ? 'Direct browser upgrade enabled' : 'Relay circuit only'}
			</p>
		</div>

		<button
			type="button"
			role="switch"
			aria-label="Toggle WebRTC peer connections"
			aria-checked={$webrtcEnabledStore}
			class="relative h-7 w-12 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 {$webrtcEnabledStore
				? 'bg-green-600'
				: 'bg-gray-300'}"
			data-testid="webrtc-toggle-button"
			on:click={toggleWebRTC}
			{disabled}
		>
			<span
				class="absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-transform {$webrtcEnabledStore
					? 'translate-x-6'
					: 'translate-x-1'}"
			></span>
		</button>
	</div>
</div>
