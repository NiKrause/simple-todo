import { describe, expect, it } from 'vitest';
import de from '../i18n/de.json';
import en from '../i18n/en.json';
import {
	CATALOGUES,
	DOC_SECTIONS,
	EVIDENCE,
	STEPS,
	budgetNote,
	explanation,
	segments,
	shortHash,
	sourceLabel
} from './index.js';

// The documents the texts restate, as they are in this checkout.
const docs = /** @type {Record<string, string>} */ (
	import.meta.glob('/docs/*.md', { query: '?raw', import: 'default', eager: true })
);

/**
 * @param {string} markdown
 * @param {string} heading
 */
function hasHeading(markdown, heading) {
	return markdown
		.split('\n')
		.some((line) => /^#{1,6} /.test(line) && line.replace(/^#{1,6} /, '').trim() === heading);
}

describe('the technical explanations', () => {
	it('explain the same steps in both languages', () => {
		expect(Object.keys(CATALOGUES.de).sort()).toEqual([...STEPS].sort());
		expect(Object.keys(CATALOGUES.en).sort()).toEqual([...STEPS].sort());
	});

	it('mirror each other: sections, points, sources and links', () => {
		// The German text follows the English one point for point, so a sync after
		// a document changed touches the same place in both.
		for (const step of STEPS) {
			const de = CATALOGUES.de[step];
			const en = CATALOGUES.en[step];
			expect(de.sections.length, step).toBe(en.sections.length);
			en.sections.forEach((section, index) => {
				const twin = de.sections[index];
				const where = `${step} / ${section.heading}`;
				expect(twin.points.length, where).toBe(section.points.length);
				expect(twin.sources, where).toEqual(section.sources);
				expect(
					(twin.links ?? []).map((link) => link.evidence),
					where
				).toEqual((section.links ?? []).map((link) => link.evidence));
			});
		}
	});

	it('have no empty text and close every code span', () => {
		for (const [language, catalogue] of Object.entries(CATALOGUES)) {
			for (const step of STEPS) {
				const { title, sections } = catalogue[step];
				expect(title.trim(), `${language}: ${step}`).not.toBe('');
				for (const section of sections) {
					expect(section.heading.trim(), `${language}: ${step}`).not.toBe('');
					expect(section.points.length, `${language}: ${section.heading}`).toBeGreaterThan(0);
					expect(section.sources.length, `${language}: ${section.heading}`).toBeGreaterThan(0);
					for (const text of [title, ...section.points]) {
						expect(text.trim(), `${language}: ${section.heading}`).not.toBe('');
						expect((text.match(/`/g) ?? []).length % 2, `${language}: ${text}`).toBe(0);
						// Rendered as text: markup here would be shown, not interpreted.
						expect(text, `${language}: ${text}`).not.toMatch(/<[a-z/]/i);
					}
				}
			}
		}
	});

	it('name only sections that exist in the documents, in both languages', () => {
		// When a document renames or drops a section, this names the texts that
		// were taken from it and have to be looked at again.
		const used = new Set(
			Object.values(CATALOGUES).flatMap((catalogue) =>
				STEPS.flatMap((step) => catalogue[step].sections.flatMap((section) => section.sources))
			)
		);
		for (const id of used) {
			expect(Object.keys(DOC_SECTIONS), id).toContain(id);
			for (const language of ['en', 'de']) {
				const { file, heading } = sourceLabel(/** @type {any} */ (id), language);
				const markdown = docs[`/${file}`];
				expect(markdown, `${file} is missing`).toBeTypeOf('string');
				expect(hasHeading(markdown, heading), `${file}: "${heading}" (${id})`).toBe(true);
			}
		}
	});

	it('link only to the Sepolia run on Etherscan', () => {
		const hashes = [
			'0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429',
			'0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065',
			'0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6',
			'0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c',
			'0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de',
			'0x79a1a622a864129daa23d887d9c56fee578066222065dab6514c5cbe830c4b51'
		];
		expect(
			Object.values(EVIDENCE)
				.map((entry) => entry.hash)
				.sort()
		).toEqual([...hashes].sort());
		for (const entry of Object.values(EVIDENCE)) {
			expect(entry.href.startsWith('https://sepolia.etherscan.io/')).toBe(true);
			expect(entry.href).toContain(entry.hash);
		}
		// The demo notice is where the whole run is linked.
		const demoLinks = CATALOGUES.en.demo.sections.flatMap((section) =>
			(section.links ?? []).map((link) => link.evidence)
		);
		expect(demoLinks.sort()).toEqual(Object.keys(EVIDENCE).sort());
	});

	it('fall back to English like the i18n catalogues', () => {
		expect(explanation('lock', 'de')).toBe(CATALOGUES.de.lock);
		expect(explanation('lock', 'de-AT')).toBe(CATALOGUES.de.lock);
		expect(explanation('lock', 'en')).toBe(CATALOGUES.en.lock);
		expect(explanation('lock', 'fr')).toBe(CATALOGUES.en.lock);
		expect(explanation('lock', null)).toBe(CATALOGUES.en.lock);
	});

	it('say where a text comes from in the reader’s language', () => {
		expect(sourceLabel('escrow.lock', 'de')).toEqual({
			file: 'docs/escrow.de.md',
			heading: 'Sperren: technisch'
		});
		expect(sourceLabel('escrow.lock', 'en')).toEqual({
			file: 'docs/escrow.md',
			heading: 'Lock: technical'
		});
	});
});

describe('the underfunded lock, in the technical texts', () => {
	it('says the lock is mined, gas is paid and an encrypted 0 moves', () => {
		const text = (/** @type {'de' | 'en'} */ language) =>
			CATALOGUES[language].underfunded.sections.flatMap((section) => section.points).join(' ');
		expect(text('en')).toContain('mined and the gas is paid');
		expect(text('en')).toContain('encrypted 0');
		expect(text('de')).toContain('in einen Block aufgenommen, und das Gas ist bezahlt');
		expect(text('de')).toContain('verschlüsselte 0');
	});
});

describe('segments', () => {
	it('splits text and code at backticks', () => {
		expect(segments('Calls `FHE.fromExternal` first.')).toEqual([
			{ code: false, text: 'Calls ' },
			{ code: true, text: 'FHE.fromExternal' },
			{ code: false, text: ' first.' }
		]);
		expect(segments('`a` and `b`')).toEqual([
			{ code: true, text: 'a' },
			{ code: false, text: ' and ' },
			{ code: true, text: 'b' }
		]);
		expect(segments('no code')).toEqual([{ code: false, text: 'no code' }]);
	});

	it('leaves markup as text', () => {
		expect(segments('<img src=x onerror=alert(1)>')).toEqual([
			{ code: false, text: '<img src=x onerror=alert(1)>' }
		]);
	});

	it('shortens a hash the way the texts write them', () => {
		expect(shortHash(EVIDENCE.lock.hash)).toBe('0x04259275…6065');
	});
});

describe('the note under a todo’s budget', () => {
	it('says who sees a locked amount, and explains reading it', () => {
		expect(budgetNote({ status: 'funded', perspective: 'owner' })).toMatchObject({
			message: 'budget.note.visibleParty',
			step: 'locked'
		});
		expect(
			budgetNote({ status: 'funded', perspective: 'beneficiary', completed: true })
		).toMatchObject({ message: 'budget.note.visibleParty', step: 'locked' });
		expect(budgetNote({ status: 'funded', perspective: 'other' })).toMatchObject({
			message: 'budget.note.visibleOther',
			step: 'locked'
		});
	});

	it('offers the owner of a completed todo the release, and explains it', () => {
		expect(budgetNote({ status: 'funded', perspective: 'owner', completed: true })).toMatchObject({
			message: 'budget.note.releaseOffered',
			step: 'release'
		});
	});

	it('explains the release once it is under way and after it', () => {
		expect(budgetNote({ status: 'releasing', perspective: 'owner' }).step).toBe('release');
		expect(budgetNote({ status: 'released', perspective: 'owner' }).message).toBe(
			'budget.note.releasedOwner'
		);
		expect(budgetNote({ status: 'released', perspective: 'beneficiary' }).message).toBe(
			'budget.note.releasedBeneficiary'
		);
		expect(budgetNote({ status: 'released', perspective: 'other' })).toMatchObject({
			message: 'budget.note.releasedOther',
			step: 'release'
		});
	});

	it('tells an underfunded lock from a cancelled one and from other failures', () => {
		expect(
			budgetNote({ status: 'failed', lastError: 'insufficient-balance', perspective: 'owner' })
		).toMatchObject({ message: 'budget.note.underfunded', step: 'underfunded' });
		expect(
			budgetNote({ status: 'failed', lastError: 'passkey-cancelled', perspective: 'owner' })
		).toMatchObject({ message: 'budget.note.cancelled', step: 'cancelled' });
		expect(
			budgetNote({ status: 'failed', lastError: 'unknown', perspective: 'owner' })
		).toMatchObject({ message: null, step: null });
	});

	it('has a sentence in both languages for every note it can pick', () => {
		/** @type {Array<import('../budget.js').BudgetStatus>} */
		const statuses = ['none', 'locking', 'funded', 'releasing', 'released', 'failed'];
		const messages = new Set();
		for (const status of statuses) {
			for (const perspective of /** @type {const} */ (['owner', 'beneficiary', 'other'])) {
				for (const completed of [false, true]) {
					for (const lastError of [null, 'insufficient-balance', 'passkey-cancelled', 'unknown']) {
						const { message } = budgetNote({ status, lastError, perspective, completed });
						if (message) messages.add(message);
					}
				}
			}
		}
		const at = (/** @type {any} */ catalogue, /** @type {string} */ key) =>
			key.split('.').reduce((node, part) => node?.[part], catalogue);
		expect(messages.size).toBe(8);
		for (const message of messages) {
			expect(at(en, message), `en: ${message}`).toBeTypeOf('string');
			expect(at(de, message), `de: ${message}`).toBeTypeOf('string');
		}
	});

	it('says nothing without a budget, and nothing technical while a lock is on its way', () => {
		expect(budgetNote({ status: 'none', perspective: 'owner' }).message).toBeNull();
		expect(budgetNote({ status: 'locking', perspective: 'beneficiary' })).toMatchObject({
			message: 'budget.note.visibleParty',
			step: null
		});
	});
});
