<script>
	// The handful of line icons the budget screens use (Lucide's shapes, drawn
	// inline like the rest of this app's icons). Decorative: the words beside
	// them carry the meaning.

	/** @type {'key' | 'pen' | 'lock' | 'shield' | 'eye' | 'check' | 'alert'} */
	export let name;
	export let size = 16;
	export let strokeWidth = 2;
	export let className = '';
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	class="shrink-0 {className}"
	aria-hidden="true"
>
	{#if name === 'key'}
		<circle cx="7.5" cy="15.5" r="5.5" />
		<path d="m21 2-9.6 9.6" />
		<path d="m15.5 7.5 3 3L22 7l-3-3" />
	{:else if name === 'pen'}
		<path d="M12 20h9" />
		<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
	{:else if name === 'lock'}
		<rect x="4" y="11" width="16" height="10" rx="2" />
		<path d="M8 11V7a4 4 0 0 1 8 0v4" />
	{:else if name === 'shield'}
		<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
		<path d="m9 12 2 2 4-4" />
	{:else if name === 'eye'}
		<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
		<circle cx="12" cy="12" r="3" />
	{:else if name === 'check'}
		<path d="M20 6 9 17l-5-5" />
	{:else if name === 'alert'}
		<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
		<path d="M12 9v4" />
		<path d="M12 17h.01" />
	{/if}
</svg>
