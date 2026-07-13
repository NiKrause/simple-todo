import { describe, expect, it, vi } from 'vitest';
import {
	SPANISH_WORDS_V1,
	generateSpanishMnemonic,
	isValidSpanishMnemonic,
	normalizeSpanishMnemonic
} from './spanish-mnemonic.js';

describe('Spanish shared-list mnemonic', () => {
	it('generates exactly three configured words with an injectable secure source', () => {
		const randomValues = vi.fn((array) => {
			array.set([29, 9, 53]);
			return array;
		});
		expect(generateSpanishMnemonic(randomValues)).toBe('luna-camino-verde');
		expect(randomValues).toHaveBeenCalledOnce();
	});

	it('keeps every generated word inside the versioned list', () => {
		const mnemonic = generateSpanishMnemonic((array) => {
			array.set([3, 34, 36]);
			return array;
		});
		const words = mnemonic.split('-');
		expect(words).toHaveLength(3);
		expect(words.every((word) => SPANISH_WORDS_V1.includes(word))).toBe(true);
	});

	it.each([
		[' LUNA camino VERDE ', 'luna-camino-verde'],
		['luna camino verde', 'luna-camino-verde'],
		['luna_camino_verde', 'luna-camino-verde'],
		['A\u0301RBOL música océano', 'árbol-música-océano']
	])('normalizes %s to one NFC database name', (input, expected) => {
		expect(normalizeSpanishMnemonic(input)).toBe(expected);
		expect(normalizeSpanishMnemonic(input).normalize('NFC')).toBe(expected);
	});

	it.each([
		'',
		'luna-camino',
		'luna-camino-verde-sol',
		'luna--camino-verde',
		'luna-desconocida-verde'
	])('rejects invalid input %s', (input) => {
		expect(() => normalizeSpanishMnemonic(input)).toThrow();
		expect(isValidSpanishMnemonic(input)).toBe(false);
	});

	it('maps the same mnemonic deterministically and different mnemonics differently', () => {
		expect(normalizeSpanishMnemonic('LUNA CAMINO VERDE')).toBe(
			normalizeSpanishMnemonic('luna-camino-verde')
		);
		expect(normalizeSpanishMnemonic('luna-camino-verde')).not.toBe(
			normalizeSpanishMnemonic('sol-camino-verde')
		);
	});
});
