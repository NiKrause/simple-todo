<script>
	import '../app.css';
	// import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
  <title>Simple TODO List {__APP_VERSION__}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="A simpleer-to-peer TODO list application using OrbitDB and IPFS" />
  <meta name="author" content="Nico Krause" />
  <meta name="keywords" content="peer-to-peer, local-first,libp2p, todo, list, orbitdb, ipfs" />
</svelte:head>

{@render children?.()}
