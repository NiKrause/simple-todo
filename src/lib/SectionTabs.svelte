<script>
	// The tab bar (escrow01). At the foot of the screen on a phone, where a thumb
	// reaches it, and under the header on anything wider. One element for both
	// places, so a screen reader and a test find one set of tabs, not two.
	//
	// Links to the page's own fragments rather than buttons: the browser then
	// keeps the history, so the back button goes back one tab, and a tab can be
	// linked to. Which one is open is the fragment's business (sections.js).
	import { _ } from '$lib/i18n/index.js';
	import SectionIcon from './SectionIcon.svelte';
	import { TAB_SECTIONS, currentSection } from './sections.js';

	const LABELS = {
		aufgaben: 'sections.tab.tasks',
		listen: 'sections.tab.lists',
		konto: 'sections.tab.account',
		netzwerk: 'sections.tab.network'
	};
</script>

<nav
	aria-label={$_('sections.label')}
	data-testid="section-tabs"
	class="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] sm:static sm:z-auto sm:mb-6 sm:border-t-0 sm:border-b sm:bg-transparent sm:pb-0"
>
	<ul class="mx-auto grid max-w-4xl grid-cols-4 sm:flex sm:gap-1">
		{#each TAB_SECTIONS as id (id)}
			{@const active = $currentSection === id}
			<li class="min-w-0">
				<a
					href={`#${id}`}
					aria-current={active ? 'page' : undefined}
					data-testid={`tab-${id}`}
					data-active={active}
					class="flex flex-col items-center gap-0.5 rounded-md px-1 py-2 text-[11px] font-medium no-underline outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 sm:-mb-px sm:flex-row sm:gap-2 sm:rounded-none sm:border-b-2 sm:px-3 sm:py-2.5 sm:text-sm {active
						? 'text-cyan-800 sm:border-cyan-800 dark:text-cyan dark:sm:border-cyan'
						: 'text-text hover:text-heading sm:border-transparent'}"
				>
					<SectionIcon name={id} />
					<span class="max-w-full truncate">{$_(LABELS[id])}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
