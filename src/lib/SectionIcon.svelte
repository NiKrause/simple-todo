<script>
	// One icon per tab (escrow01). Drawn here rather than taken from a library:
	// four shapes do not justify a dependency.

	/** @type {'aufgaben' | 'listen' | 'konto' | 'netzwerk'} */
	export let name;
</script>

<svg
	class="h-5 w-5 shrink-0"
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.8"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'aufgaben'}
		<!-- A ticked box. -->
		<rect x="3.5" y="3.5" width="17" height="17" rx="3" />
		<path d="M8 12.5l2.8 2.8L16.5 9" />
	{:else if name === 'listen'}
		<!-- Three rows. -->
		<path d="M9 6.5h11M9 12h11M9 17.5h11" />
		<path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" stroke-width="2.6" />
	{:else if name === 'konto'}
		<!-- A card: the account the passkey stands for. -->
		<rect x="3" y="5.5" width="18" height="13" rx="2.5" />
		<path d="M3 9.5h18M15.5 14.5h2.5" />
	{:else}
		<!-- A globe. -->
		<circle cx="12" cy="12" r="8.5" />
		<path
			d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5s1.2-6.1 3.5-8.5z"
		/>
	{/if}
</svg>
