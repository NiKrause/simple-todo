<script>
	import { _ } from '$lib/i18n/index.js';
	/**
	 * Light/dark theme toggle. Flips a `.dark` class on <html>, persists the
	 * choice to localStorage, and keeps the browser <meta name="theme-color"> in
	 * sync. Initial state is set before paint by the no-flash script in app.html.
	 */
	import { onMount } from 'svelte';

	let dark = $state(false);

	onMount(() => {
		dark = document.documentElement.classList.contains('dark');
	});

	function apply(next) {
		dark = next;
		document.documentElement.classList.toggle('dark', next);
		try {
			localStorage.setItem('theme', next ? 'dark' : 'light');
		} catch {
			/* storage unavailable — session-only toggle */
		}
		const meta = document.querySelector('meta[name="theme-color"]');
		if (meta) meta.setAttribute('content', next ? '#0B0E15' : '#EDF1F8');
	}
</script>

<button
	type="button"
	onclick={() => apply(!dark)}
	class="rounded-full p-2 text-text transition hover:bg-surface hover:text-coral focus:ring-2 focus:ring-cyan focus:outline-none"
	aria-label={dark ? $_('theme.toLight') : $_('theme.toDark')}
	title={dark ? $_('theme.light') : $_('theme.dark')}
>
	{#if dark}
		<!-- sun -->
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="4" />
			<path
				d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
			/>
		</svg>
	{:else}
		<!-- moon -->
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	{/if}
</button>
