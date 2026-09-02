import { describe, expect, it } from 'vitest';

import { CHAPTER_PARTS } from './chapter-parts.js';
import { HANDOVER_PROTOCOL } from './handover-protocol.js';
import en from './i18n/en.json';
import de from './i18n/de.json';

// Objects rather than `[name, dictionary]` tuples: an array of pairs infers as
// `(string | Dictionary)[]`, and every use of the dictionary then has to be
// talked out of being a string.
const DICTIONARIES = [
	{ name: 'en', dictionary: en },
	{ name: 'de', dictionary: de }
];

/**
 * The translated parts, as a record rather than the exact object literal the
 * JSON import infers — the whole point here is to look up keys that may not be
 * there, which is precisely what that inferred type forbids.
 *
 * @param {any} dictionary
 * @returns {Record<string, { label: string, text: string }>}
 */
const partsOf = (dictionary) => dictionary.intro.chapter.parts;

// The parts list is split across three files on purpose — structure here,
// prose in the translations, versions in `package.json` — so that the intro
// dialog and the README can render one list instead of two. Splitting it also
// creates three ways for it to fall out of step, and these are those three.
//
// The README half is checked by `node scripts/sync-chapter-readme.mjs --check`
// in CI rather than here: this suite runs in a browser, where there is no
// filesystem to compare a file against.

describe('the chapter parts list', () => {
	it('has a label and a description in both languages', () => {
		for (const part of CHAPTER_PARTS) {
			for (const { name, dictionary } of DICTIONARIES) {
				const copy = partsOf(dictionary)[part.key];
				// Named rather than asserted as truthy: a missing key otherwise
				// fails as "expected undefined to be defined", which says nothing
				// about which part or which language.
				expect(copy, `${name}: no strings for part "${part.key}"`).toBeTruthy();
				expect(copy.label, `${name}: no label for "${part.key}"`).toBeTruthy();
				expect(copy.text, `${name}: no text for "${part.key}"`).toBeTruthy();
			}
		}
	});

	it('translates nothing that is no longer in the list', () => {
		// The other direction, and the one that rots quietly: a part removed from
		// the structure leaves its prose behind, where it reads as documentation
		// of something the chapter still does.
		const keys = new Set(CHAPTER_PARTS.map((part) => part.key));
		for (const { name, dictionary } of DICTIONARIES) {
			for (const key of Object.keys(partsOf(dictionary))) {
				expect(keys.has(key), `${name}: "${key}" is translated but not in CHAPTER_PARTS`).toBe(
					true
				);
			}
		}
	});

	it('names the protocol the app actually speaks', () => {
		// The one entry that is ours rather than a dependency, and therefore the
		// one nothing else would catch: renaming the protocol without renaming it
		// here would leave the dialog and the README teaching an id that no peer
		// answers on.
		const part = CHAPTER_PARTS.find((entry) => entry.protocol);
		expect(part?.protocol).toBe(HANDOVER_PROTOCOL);
	});

	it('gives every part either a package or a protocol', () => {
		for (const part of CHAPTER_PARTS) {
			expect(
				part.packages.length > 0 || Boolean(part.protocol),
				`"${part.key}" names nothing a reader could go and look at`
			).toBe(true);
		}
	});
});
