<script>
	import '../app.css';
	import '$lib/i18n/index.js';
	// import favicon from '$lib/assets/favicon.svg';

	// Imported for its side effect: the module initialises svelte-i18n on load.
	// Nothing here calls it, and nothing needs to — see the note in that file
	// for why setup is tied to the import rather than to a lifecycle hook.

	import { onMount } from 'svelte';

	let { children } = $props();

	// Recover from a deployment that happened while this page was open.
	//
	// The service worker serves the shell stale-while-revalidate, so after a
	// deploy a visitor can still be running the previous document — and its
	// chunk names no longer exist under the new CID:
	//
	//   Failed to fetch dynamically imported module:
	//   https://qr01.le-space.de/_app/immutable/chunks/DW_qxEhy.js   → 404
	//
	// This was always latent; it became visible when the networking code and
	// the relay lookup moved behind dynamic imports, because the failure now
	// lands when someone presses a button rather than at load. Vite reports it
	// as `vite:preloadError`, so reload once and let the new shell take over.
	// Guarded through sessionStorage: if the reload does not fix it, showing
	// the real error beats a reload loop.
	const RELOAD_STAMP_KEY = 'qr01.staleChunkReloadedAt';
	const RELOAD_COOLDOWN_MS = 60_000;
	onMount(() => {
		/** @param {Event} event */
		const onPreloadError = (event) => {
			// One reload per minute at most. Clearing a flag on a successful mount
			// would not bound anything — the reload *is* a successful mount — so
			// the guard has to be a timestamp: recover from a deploy that lands
			// mid-session, but never spin if the new shell is broken too.
			let last = 0;
			try {
				last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY) ?? 0);
			} catch {
				// Storage blocked: a reload could loop unbounded, so let the error
				// surface instead.
				return;
			}
			if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
			event.preventDefault();
			try {
				sessionStorage.setItem(RELOAD_STAMP_KEY, String(Date.now()));
			} catch {
				return;
			}
			location.reload();
		};
		window.addEventListener('vite:preloadError', onPreloadError);
		return () => window.removeEventListener('vite:preloadError', onPreloadError);
	});
</script>

<svelte:head>
	<!-- Dynamic title with build info -->
	<title
		>QR-Todo {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'} [{typeof __BUILD_DATE__ !==
		'undefined'
			? __BUILD_DATE__
			: 'dev'}]</title
	>
</svelte:head>

{@render children?.()}
