<script>
	import { locale } from '$lib/i18n/index.js';
	import { setLocale } from './i18n/index.js';

	// Flags, not a dropdown: two options do not need one, and a flag is
	// recognisable before any of the surrounding words are. The label still
	// carries the language name for screen readers and for anyone who cannot
	// tell the flags apart at a glance.
	const options = /** @type {const} */ ([
		{ code: 'de', flag: '🇩🇪', label: 'Deutsch' },
		{ code: 'en', flag: '🇬🇧', label: 'English' }
	]);
</script>

<div class="flex items-center gap-1" data-testid="language-switcher">
	{#each options as option (option.code)}
		<button
			type="button"
			lang={option.code}
			aria-label={option.label}
			aria-pressed={$locale === option.code}
			data-testid={`language-${option.code}`}
			class="rounded-md px-1.5 py-1 text-lg leading-none transition hover:bg-surface-2 {$locale ===
			option.code
				? 'opacity-100'
				: 'opacity-40 hover:opacity-80'}"
			on:click={() => setLocale(option.code)}
		>
			{option.flag}
		</button>
	{/each}
</div>
