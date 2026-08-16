import { addMessages, init, getLocaleFromNavigator, locale as i18nLocale } from 'svelte-i18n';
import de from './de.json';
import en from './en.json';

/**
 * Two languages, both compiled into the bundle.
 *
 * `addMessages` rather than `register()`: register loads a dictionary over the
 * network on first use, and this chapter's whole claim is that it works on a
 * building site with no uplink. A language switch that needed a connection
 * would fail in exactly the situation the app exists for — and it would fail
 * quietly, showing raw message keys.
 *
 * The cost is that both dictionaries ship to everyone. For two languages and a
 * few dozen strings that is a rounding error next to the libp2p bundle.
 */
addMessages('de', de);
addMessages('en', en);

export const SUPPORTED = /** @type {const} */ (['de', 'en']);
const STORAGE_KEY = 'qr01.locale';

/**
 * The language to start in.
 *
 * A stored choice wins, because someone who reached for the flag meant it and
 * should not have to reach again. Otherwise the browser's own setting decides —
 * `de-AT` and `de-CH` are speakers of German, so only the primary subtag is
 * consulted. Anything else lands on English.
 *
 * @returns {'de' | 'en'}
 */
export function initialLocale() {
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'de' || stored === 'en') return stored;
	} catch {
		// Storage blocked; fall through to the browser's setting.
	}

	const fromBrowser = (getLocaleFromNavigator() || 'en').slice(0, 2).toLowerCase();
	return fromBrowser === 'de' ? 'de' : 'en';
}

/** @param {'de' | 'en'} next */
export function setLocale(next) {
	i18nLocale.set(next);
	try {
		localStorage.setItem(STORAGE_KEY, next);
	} catch {
		// Storage blocked: the choice holds for this session and no longer.
	}
}

/**
 * Initialised on import, and `_` is re-exported from here rather than from
 * `svelte-i18n` directly.
 *
 * The obvious placement — calling this from `+layout.svelte` — looks right and
 * is a trap: anything rendered without that layout has no locale, and
 * `svelte-i18n` does not degrade, it throws
 * *"Cannot format a message without first setting the initial locale"*. The
 * component test for `+page.svelte` mounts the page on its own and hit exactly
 * that.
 *
 * Tying setup to the import removes the ordering question altogether: a module
 * that can translate has, by construction, already loaded the thing that makes
 * translation possible.
 *
 * The fallback is English so a key missing from the German dictionary shows the
 * English sentence rather than the key — a visible `transfer.start` is worse
 * than a sentence in the wrong language.
 */
init({
	fallbackLocale: 'en',
	initialLocale: initialLocale()
});

export { _, locale } from 'svelte-i18n';
