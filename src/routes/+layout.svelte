<script>
	import '../app.css';
	import '$lib/i18n/index.js';
	// import favicon from '$lib/assets/favicon.svg';

	// Imported for its side effect: the module initialises svelte-i18n on load.
	// Nothing here calls it, and nothing needs to — see the note in that file
	// for why setup is tied to the import rather than to a lifecycle hook.

	let { children } = $props();
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
