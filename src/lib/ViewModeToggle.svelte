<script>
	import { _ } from '$lib/i18n/index.js';
	import { simpleView, toggleView } from './view-mode.js';
</script>

<!--
	Deliberately small and at the edge. The person this app is being simplified
	for should be able to ignore it entirely; the person who wants the
	diagnostics only has to find it once, because the choice is remembered.
-->
<button
	type="button"
	data-testid="view-mode-toggle"
	aria-pressed={!$simpleView}
	title={$simpleView ? $_('view.switchToTechnical') : $_('view.switchToSimple')}
	class="rounded-md border border-border px-2 py-1 text-xs font-medium text-faint transition hover:bg-surface-2 hover:text-text"
	on:click={toggleView}
>
	{$simpleView ? $_('view.technical') : $_('view.simple')}
</button>
