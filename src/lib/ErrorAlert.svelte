<script>
	import { createEventDispatcher } from 'svelte';
	import { _ } from '$lib/i18n/index.js';

	/** @type {string | null} */
	export let error = null;
	/** @type {'error' | 'warning' | 'info'} */
	export let type = 'error'; // 'error', 'warning', 'info'
	export let dismissible = false;
	export let title = '';
	export let compact = false;
	/** Set the title in bold at the start of the message rather than on a line of its own. */
	export let inlineTitle = false;

	let visible = true;
	const dispatch = createEventDispatcher();

	$: alertClasses = getAlertClasses(type, compact);
	$: if (error) visible = true;

	// The light text tones are one step darker than the palette's -700: cyan-700
	// on cyan-100 and data-700 on data-100 measure 3.4:1 and 3.6:1, below AA for
	// the sentences escrow01's notices put here.
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
				return `${baseClasses} bg-data-100 border-data-400 text-data-800 dark:bg-data/10 dark:border-data/40 dark:text-data`;
			case 'info':
				return `${baseClasses} bg-cyan-100 border-cyan-400 text-cyan-800 dark:bg-cyan/10 dark:border-cyan/40 dark:text-cyan`;
			default: // error
				return `${baseClasses} bg-danger-100 border-danger-400 text-danger-700 dark:bg-danger/10 dark:border-danger/40 dark:text-danger`;
		}
	}

	function dismiss() {
		visible = false;
		dispatch('dismiss');
	}
</script>

{#if error && visible}
	<div class={alertClasses}>
		<div class="flex items-start justify-between">
			<slot name="icon" />
			<div class="flex-1">
				{#if title && inlineTitle}
					<strong class="font-semibold">{title}</strong>
				{:else if title}
					<div class="mb-1 font-semibold">{title}</div>
				{/if}
				{#if typeof error === 'string'}
					{error}
				{:else}
					{$_('alert.errorPrefix')}
					{error}
				{/if}
			</div>
			{#if $$slots.actions}
				<div class="ml-4 flex shrink-0 items-center gap-2 self-center">
					<slot name="actions" />
				</div>
			{/if}
			{#if dismissible}
				<button
					on:click={dismiss}
					class="ml-2 text-lg font-bold opacity-70 hover:opacity-100"
					aria-label={$_('alert.dismiss')}
				>
					×
				</button>
			{/if}
		</div>
		<!-- Below the message and across the whole alert: escrow01's technical view. -->
		<slot name="details" />
	</div>
{/if}
