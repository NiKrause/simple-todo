export const SPANISH_MNEMONIC_VERSION = 1;
export const SPANISH_MNEMONIC_STORAGE_KEY = `simpleTodo.sharedListMnemonic.v${SPANISH_MNEMONIC_VERSION}`;

// Exactly 64 reviewed words keep random index selection unbiased from six random bits.
export const SPANISH_WORDS_V1 = Object.freeze([
	'agua',
	'aire',
	'alba',
	'árbol',
	'arena',
	'barco',
	'bosque',
	'brisa',
	'café',
	'camino',
	'campo',
	'canción',
	'casa',
	'cielo',
	'clave',
	'colina',
	'color',
	'coral',
	'corazón',
	'cristal',
	'día',
	'estrella',
	'flor',
	'fuego',
	'gato',
	'hoja',
	'isla',
	'jardín',
	'lago',
	'luna',
	'luz',
	'mar',
	'mesa',
	'montaña',
	'música',
	'nube',
	'océano',
	'oro',
	'pájaro',
	'piedra',
	'playa',
	'puerta',
	'río',
	'rojo',
	'sal',
	'selva',
	'sol',
	'sombra',
	'sueño',
	'tierra',
	'torre',
	'tren',
	'valle',
	'verde',
	'viento',
	'viaje',
	'vida',
	'zorro',
	'abrazo',
	'amigo',
	'baile',
	'fruta',
	'mundo',
	'noche'
]);

const WORD_SET = new Set(SPANISH_WORDS_V1);
const NON_SPACE_SEPARATOR = /[_\-‐-―]/u;
const REPEATED_NON_SPACE_SEPARATOR = /[_\-‐-―]{2,}/u;

/**
 * @param {(array: Uint32Array) => Uint32Array} [randomValues]
 */
export function generateSpanishMnemonic(randomValues = defaultRandomValues) {
	const values = randomValues(new Uint32Array(3));
	if (!(values instanceof Uint32Array) || values.length < 3) {
		throw new Error('Secure random source must return at least three Uint32 values.');
	}
	return Array.from(values.slice(0, 3), (value) => SPANISH_WORDS_V1[value & 63]).join('-');
}

/** @param {string} input */
export function normalizeSpanishMnemonic(input) {
	if (typeof input !== 'string') throw new Error('Enter a three-word Spanish share code.');

	const normalized = input.normalize('NFC').trim().toLocaleLowerCase('es');
	if (!normalized) throw new Error('Enter a three-word Spanish share code.');
	if (REPEATED_NON_SPACE_SEPARATOR.test(normalized)) {
		throw new Error('Do not use empty words or repeated separators.');
	}

	const withSpaces = normalized.replace(/\s+/gu, ' ').replace(/[_\-‐-―]/gu, ' ');
	const words = withSpaces.split(' ');
	if (words.length !== 3 || words.some((word) => !word)) {
		throw new Error('The share code must contain exactly three Spanish words.');
	}
	const unknownWord = words.find((word) => !WORD_SET.has(word));
	if (unknownWord) throw new Error(`Unknown Spanish share-code word: ${unknownWord}`);
	return words.join('-');
}

/** @param {string} input */
export function isValidSpanishMnemonic(input) {
	try {
		normalizeSpanishMnemonic(input);
		return true;
	} catch {
		return false;
	}
}

/** @param {Uint32Array} array */
function defaultRandomValues(array) {
	if (!globalThis.crypto?.getRandomValues) {
		throw new Error('Secure random generation is unavailable in this browser.');
	}
	return globalThis.crypto.getRandomValues(array);
}
