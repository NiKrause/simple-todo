<script>
	/**
	 * The eight startup steps, as dots with a tooltip.
	 *
	 * Its own component because it now appears in two places — above the fold
	 * while the stack is still coming up, and inside the network details once
	 * it is up — and `P2PStatusNav` uses `<slot>`, which Svelte 5 will not let
	 * a `{#snippet}` share a component with.
	 */

	/** @type {any[]} */
	export let steps = [];
	/** @type {any} */
	export let active = null;
</script>

<div class="flex flex-wrap items-center gap-x-5 gap-y-2">
	{#each steps as step (step.label)}
		<div
			class="flex cursor-help items-center gap-2 text-xs whitespace-nowrap text-faint outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
			aria-label={`${step.label}: ${step.description}`}
			data-testid="p2p-status-step"
			data-status={step.status}
			role="button"
			tabindex="0"
			on:mouseenter={() => (active = step)}
			on:mouseleave={() => (active = null)}
			on:focus={() => (active = step)}
			on:blur={() => (active = null)}
		>
			<span
				class:animate-pulse={step.status === 'active'}
				class:bg-cyan-500={step.status === 'active'}
				class:bg-identity-500={step.status === 'complete'}
				class:bg-danger-500={step.status === 'error'}
				class:bg-surface-2={step.status === 'pending'}
				class="h-2 w-2 rounded-full shadow-sm"
				aria-hidden="true"
			></span>
			<span class:text-text={step.status === 'active'}>{step.label}</span>
		</div>
	{/each}
</div>
