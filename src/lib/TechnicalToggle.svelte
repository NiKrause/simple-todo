<script>
	// The switch between the simple and the technical view (escrow01). One
	// component for both places it sits, the consent dialog and the page header,
	// so the two read the same and switch the same page-wide setting.
	import { _ } from '$lib/i18n/index.js';
	import { technicalView } from './technical-view.js';

	/** The consent dialog keeps the test id it always had. */
	export let testid = 'technical-toggle';
</script>

<!-- Named after the view it switches to, as the consent dialog always did. -->
<button
	type="button"
	on:click={() => technicalView.toggle()}
	data-testid={testid}
	data-technical={$technicalView}
	class="rounded-md border border-border px-2 py-1 text-xs text-faint hover:text-text"
>
	{$technicalView ? $_('consent.simple') : $_('consent.technical')}
</button>
