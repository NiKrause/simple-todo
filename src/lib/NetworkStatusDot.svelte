<script>
	// The network's state in the header, on every tab (escrow01): a dot and a
	// word, and a link to the network tab, where the sentence behind the word and
	// the details are. The state comes from the status panel in that tab.
	import { _ } from '$lib/i18n/index.js';
	import { networkStateStore } from './network-status.js';

	$: state = $networkStateStore;
	$: sentence = $_(`network.simple.${state}`).replace(/\.$/, '');
	$: busy = state === 'starting' || state === 'connecting';
</script>

<a
	href="#netzwerk"
	title={sentence}
	data-testid="network-status-dot"
	data-state={state}
	class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium whitespace-nowrap text-text no-underline outline-none hover:text-heading focus-visible:ring-2 focus-visible:ring-cyan-500"
>
	<span
		class="h-2 w-2 shrink-0 rounded-full {state === 'failed'
			? 'bg-danger-500'
			: busy
				? 'bg-data-400'
				: 'bg-identity-500'}"
		class:animate-pulse={busy}
		aria-hidden="true"
	></span>
	<!-- The word first, so what is read out starts with what is on screen. -->
	<span>{$_(`sections.status.${state}`)}</span>
	<span class="sr-only">– {sentence}. {$_('sections.status.details')}</span>
</a>
