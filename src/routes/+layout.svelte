<script>
	/* eslint-disable no-undef */
	import '../app.css';
	import { formatBuildDate } from '$lib/build-info.js';
	// import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<!-- Dynamic title with build info -->
	<title
		>Simple-Todo {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'} [{formatBuildDate(
			typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : ''
		)}]</title
	>
</svelte:head>

{@render children?.()}
