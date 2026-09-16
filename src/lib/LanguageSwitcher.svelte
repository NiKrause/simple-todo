<script>
	import { _, locale } from '$lib/i18n/index.js';
	import { setLocale } from './i18n/index.js';

	/**
	 * Where it sits. `plain` in the consent dialog's header, next to the
	 * technical toggle; `segmented` in the page header, where it stands among
	 * other chips and needs an outline of its own.
	 *
	 * @type {'plain' | 'segmented'}
	 */
	export let variant = 'plain';

	// Two buttons, not a dropdown: two options do not need one. They read "DE"
	// and "EN", as escrow01's storyboard draws them in the dialog and in the
	// header alike (they were flags before). The label still carries the
	// language name for screen readers.
	const options = /** @type {const} */ ([
		{ code: 'de', short: 'DE', label: 'Deutsch' },
		{ code: 'en', short: 'EN', label: 'English' }
	]);
</script>

<div
	class={variant === 'segmented'
		? 'inline-flex overflow-hidden rounded-md border border-border text-xs font-semibold'
		: 'flex items-center gap-1 text-xs font-semibold'}
	role="group"
	aria-label={$_('language.switch')}
	data-testid="language-switcher"
>
	{#each options as option (option.code)}
		<button
			type="button"
			lang={option.code}
			aria-label={option.label}
			aria-pressed={$locale === option.code}
			data-testid={`language-${option.code}`}
			class={variant === 'segmented'
				? `px-1.5 py-1 leading-4 transition ${$locale === option.code ? 'bg-surface text-heading' : 'text-faint hover:text-heading'}`
				: `rounded-md px-1.5 py-1 leading-4 text-heading transition hover:bg-surface-2 ${$locale === option.code ? 'opacity-100' : 'opacity-40 hover:opacity-80'}`}
			on:click={() => setLocale(option.code)}
		>
			{option.short}
		</button>
	{/each}
</div>
