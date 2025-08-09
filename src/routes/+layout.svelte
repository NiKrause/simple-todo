<script>
	import '../app.css';
	// import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
  <!-- Dynamic title with build info -->
  <title>Simple TODO List {__APP_VERSION__} [{__BUILD_DATE__}]</title>
</svelte:head>

{@render children?.()}
