/**
 * The technical explanations of escrow01's budget steps.
 *
 * Each budget step has two levels. The simple one is a sentence in the i18n
 * catalogues, always on screen where the step happens. The technical one lives
 * here, one module per language (`de.js`, `en.js`), and shows only while the
 * page's technical view is on (`technical-view.js`).
 *
 * Not in the i18n catalogues on purpose: these texts are lists with headings,
 * inline code and links, they are long, and every section says which part of
 * the documentation it was taken from. That mapping is the point. The texts
 * restate `docs/`, they do not add to it, and when a document changes, the
 * `sources` of a section say which texts have to follow — the spec next to
 * this file fails when a named heading no longer exists.
 */

/**
 * @typedef {'lock' | 'locked' | 'underfunded' | 'release' | 'refund' | 'balance' | 'auditor' | 'readExpired' | 'cancelled' | 'demo'} StepId
 *
 * @typedef {'escrow' | 'wrap' | 'setOperator' | 'lock' | 'underfundedLock' | 'release'} EvidenceId
 *
 * @typedef {{
 *   heading: string
 *   points: string[]
 *   sources: SourceId[]
 *   links?: Array<{ evidence: EvidenceId, label: string }>
 * }} Section
 *   `points` may mark code with backticks; nothing else is interpreted.
 *
 * @typedef {{ title: string, sections: Section[] }} Explanation
 *
 * @typedef {Record<StepId, Explanation>} Catalogue
 *
 * @typedef {keyof typeof DOC_SECTIONS} SourceId
 */

import de from './de.js';
import en from './en.js';

export const STEPS = /** @type {const} */ ([
	'lock',
	'locked',
	'underfunded',
	'release',
	'refund',
	'balance',
	'auditor',
	'readExpired',
	'cancelled',
	'demo'
]);

/**
 * Where a technical text comes from: a document in `docs/` and the heading of
 * the section, in both languages. The German text follows the `.de.md` twin.
 */
export const DOC_SECTIONS = /** @type {const} */ ({
	'escrow.title': { doc: 'escrow', en: 'The confidential escrow', de: 'Die vertrauliche Treuhand' },
	'escrow.roles': { doc: 'escrow', en: 'Roles', de: 'Rollen' },
	'escrow.lock': { doc: 'escrow', en: 'Lock: technical', de: 'Sperren: technisch' },
	'escrow.release': { doc: 'escrow', en: 'Release: technical', de: 'Freigabe: technisch' },
	'escrow.refund': { doc: 'escrow', en: 'Refund: technical', de: 'Rückzahlung: technisch' },
	'escrow.states': { doc: 'escrow', en: 'States', de: 'Zustände' },
	'escrow.todoRef': { doc: 'escrow', en: '`todoRef`: technical', de: '`todoRef`: technisch' },
	'escrow.erc7984': { doc: 'escrow', en: 'ERC-7984: technical', de: 'ERC-7984: technisch' },
	'escrow.wrap': {
		doc: 'escrow',
		en: 'Wrap and unwrap: technical',
		de: 'Verpacken und Entpacken: technisch'
	},
	'escrow.underfunded': {
		doc: 'escrow',
		en: 'Underfunded lock: technical',
		de: 'Ungedeckte Sperre: technisch'
	},
	'escrow.orbitdb': { doc: 'escrow', en: 'OrbitDB: technical', de: 'OrbitDB: technisch' },
	'escrow.public': {
		doc: 'escrow',
		en: 'What is public and what is encrypted',
		de: 'Was öffentlich ist und was verschlüsselt'
	},
	'zama.fhe': {
		doc: 'zama-confidential-transactions',
		en: 'FHE: technical',
		de: 'FHE: technisch'
	},
	'zama.handles': {
		doc: 'zama-confidential-transactions',
		en: 'Handles: technical',
		de: 'Handles: technisch'
	},
	'zama.input': {
		doc: 'zama-confidential-transactions',
		en: 'Encrypted input: technical',
		de: 'Verschlüsselte Eingabe: technisch'
	},
	'zama.acl': { doc: 'zama-confidential-transactions', en: 'ACL: technical', de: 'ACL: technisch' },
	'zama.userDecryption': {
		doc: 'zama-confidential-transactions',
		en: 'User decryption: technical',
		de: 'Nutzer-Entschlüsselung: technisch'
	},
	'zama.delegated': {
		doc: 'zama-confidential-transactions',
		en: 'Delegated user decryption: technical',
		de: 'Delegierte Nutzer-Entschlüsselung: technisch'
	},
	'zama.relayer': {
		doc: 'zama-confidential-transactions',
		en: 'Relayer, Gateway and KMS: technical',
		de: 'Relayer, Gateway und KMS: technisch'
	},
	'zama.trust': {
		doc: 'zama-confidential-transactions',
		en: 'Trust: technical',
		de: 'Vertrauen: technisch'
	},
	'zama.versions': {
		doc: 'zama-confidential-transactions',
		en: 'Protocol versions: technical',
		de: 'Protokollversionen: technisch'
	},
	'smoke.etherscan': { doc: 'smoke-test', en: 'What Etherscan shows', de: 'Was Etherscan zeigt' },
	'smoke.fullRun': {
		doc: 'smoke-test',
		en: 'Full run of 2026-09-16',
		de: 'Vollständiger Lauf vom 2026-09-16'
	},
	'smoke.fund': {
		doc: 'smoke-test',
		en: 'Step 1: Fund, technical',
		de: 'Schritt 1: Guthaben beschaffen, technisch'
	},
	'smoke.operator': {
		doc: 'smoke-test',
		en: 'Step 2: Operator, technical',
		de: 'Schritt 2: Operator, technisch'
	},
	'smoke.lock': {
		doc: 'smoke-test',
		en: 'Step 3: Lock, technical',
		de: 'Schritt 3: Sperren, technisch'
	},
	'smoke.check': {
		doc: 'smoke-test',
		en: 'Step 4: Check, technical',
		de: 'Schritt 4: Prüfen, technisch'
	},
	'smoke.shortfall': {
		doc: 'smoke-test',
		en: 'Step 5: Shortfall, technical',
		de: 'Schritt 5: Unterdeckung, technisch'
	},
	'smoke.release': {
		doc: 'smoke-test',
		en: 'Step 6: Release, technical',
		de: 'Schritt 6: Freigabe, technisch'
	},
	'smoke.refund': {
		doc: 'smoke-test',
		en: 'Step 7: Refund, technical',
		de: 'Schritt 7: Rückzahlung, technisch'
	},
	'smoke.cost': { doc: 'smoke-test', en: 'Cost', de: 'Kosten' },
	'security.title': {
		doc: 'security',
		en: 'Security of the confidential escrow',
		de: 'Sicherheit der vertraulichen Treuhand'
	},
	'security.threatModel': {
		doc: 'security',
		en: 'Threat model: technical',
		de: 'Bedrohungsmodell: technisch'
	},
	'security.leaks': {
		doc: 'security',
		en: 'Leaks: technical',
		de: 'Was sichtbar wird: technisch'
	},
	'security.token': { doc: 'security', en: 'Token: technical', de: 'Token: technisch' },
	'security.auditor': { doc: 'security', en: 'Auditor: technical', de: 'Prüfstelle: technisch' },
	'security.properties': {
		doc: 'security',
		en: 'Escrow properties: technical',
		de: 'Eigenschaften der Treuhand: technisch'
	},
	'security.passkeyWallet': {
		doc: 'security',
		en: 'Passkey wallet: technical',
		de: 'Passkey-Wallet: technisch'
	},
	'account.setup': { doc: 'passkey-account', en: 'Setup: technical', de: 'Einrichtung: technisch' },
	'account.signing': {
		doc: 'passkey-account',
		en: 'Signing: technical',
		de: 'Signieren: technisch'
	},
	'account.locking': { doc: 'passkey-account', en: 'Locking: technical', de: 'Sperren: technisch' },
	'account.reading': { doc: 'passkey-account', en: 'Reading: technical', de: 'Lesen: technisch' },
	'account.measured': {
		doc: 'passkey-account',
		en: 'Measured on 2026-09-17',
		de: 'Gemessen am 2026-09-17'
	},
	'demo.real': {
		doc: 'demo',
		en: 'What is real today and what is not',
		de: 'Was heute echt ist und was nicht'
	},
	'demo.setup': { doc: 'demo', en: 'Setup', de: 'Aufbau' },
	'demo.scene1': { doc: 'demo', en: 'Scene 1 · One passkey', de: 'Szene 1 · Ein Passkey' },
	'demo.scene7': { doc: 'demo', en: 'Scene 7 · Auditor', de: 'Szene 7 · Prüfstelle' },
	'demo.scene9': {
		doc: 'demo',
		en: 'Scene 9 · Error cases (optional)',
		de: 'Szene 9 · Fehlerfälle (optional)'
	}
});

/**
 * The run of 2026-09-16 on Sepolia, as evidence of the flow the fake stands in
 * for (`docs/smoke-test.md`, "Full run of 2026-09-16"). Links are only ever
 * built from this table, so a content module cannot point anywhere else.
 */
export const EVIDENCE = /** @type {const} */ ({
	escrow: {
		hash: '0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429',
		href: 'https://sepolia.etherscan.io/address/0x6Ee3Fa9d3aEdaAD189F5DeA9d859605c9D743429#code'
	},
	wrap: {
		hash: '0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de',
		href: 'https://sepolia.etherscan.io/tx/0x567d87cb57e9b868db726e61f1924c8c227fcba10356b3b95150a0428a9186de'
	},
	setOperator: {
		hash: '0x79a1a622a864129daa23d887d9c56fee578066222065dab6514c5cbe830c4b51',
		href: 'https://sepolia.etherscan.io/tx/0x79a1a622a864129daa23d887d9c56fee578066222065dab6514c5cbe830c4b51'
	},
	lock: {
		hash: '0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065',
		href: 'https://sepolia.etherscan.io/tx/0x04259275f7a6b3a669e196ae6f16bfc9679bee932a3114fdc2507417cc116065'
	},
	underfundedLock: {
		hash: '0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6',
		href: 'https://sepolia.etherscan.io/tx/0xfbe2cd1ed19e4f0c11fd00d5fbcdb80d848b46f700c307656f88879649aeded6'
	},
	release: {
		hash: '0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c',
		href: 'https://sepolia.etherscan.io/tx/0xd9d123e6f75de8415e88dd0b7343c1b7656c33e797b67ac0fa0f89759d65022c'
	}
});

/** @type {Record<'de' | 'en', Catalogue>} */
export const CATALOGUES = { de, en };

/**
 * The explanation of `step` in `language`; English for any other language, the
 * way the i18n catalogues fall back.
 *
 * @param {StepId} step
 * @param {string | null | undefined} language
 * @returns {Explanation}
 */
export function explanation(step, language) {
	const code = String(language ?? '')
		.slice(0, 2)
		.toLowerCase();
	return (code === 'de' ? de : en)[step];
}

/**
 * A source as a reader finds it: the document of the page's language and the
 * section heading in it.
 *
 * @param {SourceId} id
 * @param {string | null | undefined} language
 */
export function sourceLabel(id, language) {
	const german = String(language ?? '').startsWith('de');
	const section = DOC_SECTIONS[id];
	return {
		file: `docs/${section.doc}${german ? '.de' : ''}.md`,
		heading: german ? section.de : section.en
	};
}

/**
 * Split a point into text and code, at backticks. The result is rendered as
 * text nodes and `<code>` elements; no markup in a point is ever interpreted.
 *
 * @param {string} text
 * @returns {Array<{ code: boolean, text: string }>}
 */
export function segments(text) {
	return String(text)
		.split('`')
		.map((part, index) => ({ code: index % 2 === 1, text: part }))
		.filter((part) => part.text !== '');
}

/** A hash short enough for a line: `0x04259275…6065`. */
export const shortHash = (/** @type {string} */ hash) => `${hash.slice(0, 10)}…${hash.slice(-4)}`;

/**
 * What a todo row says about its budget, and which step's technical
 * explanation belongs there.
 *
 * `message` is an i18n key under `budget.note`; null where the row needs no
 * sentence, for a failure the notices already explain in their own words.
 *
 * @param {{
 *   status: import('../budget.js').BudgetStatus
 *   lastError?: string | null
 *   perspective: 'owner' | 'beneficiary' | 'other'
 *   completed?: boolean
 * }} input
 * @returns {{ message: string | null, step: StepId | null, icon: 'eye' | 'lock' | 'check' | 'alert' }}
 */
export function budgetNote({ status, lastError = null, perspective, completed = false }) {
	const party = perspective === 'other' ? 'visibleOther' : 'visibleParty';
	switch (status) {
		case 'locking':
			return { message: `budget.note.${party}`, step: null, icon: 'eye' };
		case 'funded':
			if (perspective === 'owner' && completed) {
				return { message: 'budget.note.releaseOffered', step: 'release', icon: 'lock' };
			}
			return { message: `budget.note.${party}`, step: 'locked', icon: 'eye' };
		case 'releasing':
			return { message: `budget.note.${party}`, step: 'release', icon: 'eye' };
		case 'released':
			return {
				message:
					perspective === 'owner'
						? 'budget.note.releasedOwner'
						: perspective === 'beneficiary'
							? 'budget.note.releasedBeneficiary'
							: 'budget.note.releasedOther',
				step: 'release',
				icon: 'check'
			};
		case 'failed':
			if (lastError === 'insufficient-balance') {
				return { message: 'budget.note.underfunded', step: 'underfunded', icon: 'alert' };
			}
			if (lastError === 'passkey-cancelled') {
				return { message: 'budget.note.cancelled', step: 'cancelled', icon: 'alert' };
			}
			return { message: null, step: null, icon: 'alert' };
		default:
			return { message: null, step: null, icon: 'eye' };
	}
}
