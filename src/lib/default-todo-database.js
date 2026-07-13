import { normalizeSpanishMnemonic } from './spanish-mnemonic.js';

/**
 * The canonical human-readable mnemonic is the OrbitDB database name.
 * Browser identity remains independent from the shared list selection.
 * @param {string} mnemonic
 */
export function getTodoDatabaseName(mnemonic) {
	return normalizeSpanishMnemonic(mnemonic);
}
