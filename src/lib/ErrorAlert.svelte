<script>
	/** @type {string | null} */
	export let error = null;
	/** @type {'error' | 'warning' | 'info'} */
	export let type = 'error'; // 'error', 'warning', 'info'
	export let dismissible = false;
	export let title = '';
	export let compact = false;

	let visible = true;

	$: alertClasses = getAlertClasses(type, compact);
	$: if (error) visible = true;

	/**
	 * @param {'error' | 'warning' | 'info'} type
	 * @param {boolean} compact
	 */
	function getAlertClasses(type, compact) {
		const baseClasses = compact
			? 'break-words px-2 py-2 rounded mb-2 border text-xs leading-4'
			: 'break-words px-4 py-3 rounded mb-4 border';

		switch (type) {
			case 'warning':
				return `${baseClasses} bg-data-100 border-data-400 text-data-700`;
			case 'info':
				return `${baseClasses} bg-cyan-100 border-cyan-400 text-cyan-700`;
			default: // error
				return `${baseClasses} bg-danger-100 border-danger-400 text-danger-700`;
		}
	}

	function dismiss() {
		visible = false;
	}
</script>

{#if error && visible}
	<div class={alertClasses}>
		<div class="flex items-start justify-between">
			<div class="flex-1">
				{#if title}
					<div class="mb-1 font-semibold">{title}</div>
				{/if}
				<div>
					{#if typeof error === 'string'}
						{error}
					{:else}
						Error: {error}
					{/if}
				</div>
			</div>
			{#if dismissible}
				<button
					on:click={dismiss}
					class="ml-2 text-lg font-bold opacity-70 hover:opacity-100"
					aria-label="Dismiss"
				>
					×
				</button>
			{/if}
		</div>
	</div>
{/if}
