import { addMessages, init, getLocaleFromNavigator, locale as i18nLocale } from 'svelte-i18n';
import de from './de.json';
import en from './en.json';

/**
 * Two languages, both compiled into the bundle.
 *
 * `addMessages` rather than `register()`: register fetches a dictionary over
 * the network on first use, and this app is served from IPFS gateways and is
 * expected to keep working when one of them is down. A language switch that
 * needed a request would fail exactly where the app claims to be resilient —
 * and it would fail quietly, showing raw message keys.
 *
 * The cost is that both dictionaries ship to everyone. Next to the libp2p
 * bundle that is a rounding error.
 *
 * Ported from `qr01`, deliberately as the same shape rather than a variation:
 * the chapters are read side by side, and a reader comparing them should find
 * the difference in what each chapter teaches, not in how it loads strings.
 */
addMessages('de', de);
addMessages('en', en);

export const SUPPORTED = /** @type {const} */ (['de', 'en']);
const STORAGE_KEY = 'simpleTodo.locale';

/**
 * The language to start in.
 *
 * A stored choice wins, because somebody who reached for the flag meant it and
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
 * `svelte-i18n` does not degrade, it throws *"Cannot format a message without
 * first setting the initial locale"*.
 *
 * Tying setup to the import removes the ordering question: a module that can
 * translate has, by construction, already loaded the thing that makes
 * translation possible.
 *
 * The fallback is English so a key missing from the German dictionary shows the
 * English sentence rather than the key — a visible `todo.add` is worse than a
 * sentence in the wrong language.
 */
init({
	fallbackLocale: 'en',
	initialLocale: initialLocale()
});

export { _, locale } from 'svelte-i18n';
