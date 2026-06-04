<script>
	/* eslint-disable svelte/infinite-reactive-loop */
	import { onDestroy } from 'svelte';

	/** @typedef {'success' | 'error' | 'warning' | 'default'} ToastType */

	/** @type {string | null} */
	export let message = null;
	export let duration = 3000;
	/** @type {ToastType} */
	export let type = 'default'; // 'success', 'error', 'warning', 'default'

	// Auto-hide functionality
	/** @type {ReturnType<typeof setTimeout> | null} */
	let timeoutId = null;
	/** @type {string | null} */
	let lastSeenMessage = null;

	// Watch for message changes and set timeout
	$: {
		// Only act on new messages (not null -> message transitions)
		if (message && message !== lastSeenMessage) {
				if (timeoutId) clearTimeout(timeoutId);
			lastSeenMessage = message;

			if (duration > 0) {
				timeoutId = setTimeout(() => {
					// Only clear if this is still the current message
					if (message === lastSeenMessage) {
						message = null;
						lastSeenMessage = null;
					}
				}, duration);
			}
		} else if (!message) {
			lastSeenMessage = null;
		}
	}

	onDestroy(() => {
			if (timeoutId) clearTimeout(timeoutId);
		});

	// Different styles based on type
	$: toastClasses = getToastClasses(type);

		/**
		 * @param {ToastType} type
		 */
		function getToastClasses(type) {
		const baseClasses =
			'fixed top-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300';

		switch (type) {
			case 'success':
				return `${baseClasses} bg-green-600 text-white`;
			case 'error':
				return `${baseClasses} bg-red-600 text-white`;
			case 'warning':
				return `${baseClasses} bg-yellow-600 text-white`;
			default:
				return `${baseClasses} bg-gray-900 text-white`;
		}
	}
</script>

{#if message}
	<div class={toastClasses}>
		{message}
	</div>
{/if}
