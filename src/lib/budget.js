/**
 * A confidential budget on a delegated todo (escrow01): the pure rules.
 *
 * The owner of a todo locks an amount of a confidential token (cUSDT) for the
 * DID the todo is delegated to, and releases it once the todo is done. Two
 * sources of truth, kept apart on purpose (de2do#22):
 *
 * - OrbitDB holds the todo and a `budget` field with the escrow's *metadata*:
 *   status, token, escrow contract, `todoRef`, transaction hashes and the last
 *   error. Never the amount. Anyone with the list's address can read the list.
 * - The chain holds the amount, encrypted. What the app shows comes from the
 *   budget service's decrypt (`budget-service.js`), not from the todo.
 *
 * Nothing in this module touches OrbitDB or a chain, so it is unit-tested
 * directly.
 */

export const BUDGET_MODE = 'zama-confidential';

export const BUDGET_STATUSES = /** @type {const} */ ([
	'none',
	'locking',
	'funded',
	'releasing',
	'released',
	'failed'
]);

/** @typedef {(typeof BUDGET_STATUSES)[number]} BudgetStatus */

/**
 * What can go wrong, in words the UI can pick a sentence for. A service maps
 * its own failures onto these; anything it cannot map is `unknown`.
 */
export const BUDGET_ERROR_CODES = /** @type {const} */ ([
	'passkey-cancelled',
	'insufficient-balance',
	'read-access-expired',
	'escrow-exists',
	'escrow-not-found',
	'escrow-closed',
	'not-allowed',
	'invalid-amount',
	'invalid-beneficiary',
	// escrow01 on Sepolia: the delegate's DID has published no account yet.
	'beneficiary-without-account',
	'invalid-deadline',
	'unavailable',
	'unknown'
]);

/** @typedef {(typeof BUDGET_ERROR_CODES)[number]} BudgetErrorCode */

/**
 * The `budget` field of a todo.
 *
 * @typedef {{
 *   mode: 'zama-confidential'
 *   status: BudgetStatus
 *   token: string | null
 *   escrow: string | null
 *   todoRef: string | null
 *   lockTx: string | null
 *   releaseTx: string | null
 *   lastError: string | null
 * }} Budget
 */

export class BudgetError extends Error {
	/**
	 * @param {BudgetErrorCode} code
	 * @param {string} [message]
	 * @param {{ lockTx?: string | null, todoRef?: string | null }} [details]
	 *   `lockTx` when something reached the chain before the failure showed —
	 *   an underfunded lock is a mined transaction that stored an encrypted 0.
	 */
	constructor(code, message = code, details = {}) {
		super(message);
		this.name = 'BudgetError';
		/** @type {BudgetErrorCode} */
		this.code = code;
		this.details = details;
	}
}

/**
 * @param {unknown} error
 * @returns {BudgetErrorCode}
 */
export function budgetErrorCode(error) {
	const code = /** @type {any} */ (error)?.code;
	return BUDGET_ERROR_CODES.includes(code) ? code : 'unknown';
}

/** @returns {Budget} */
export function emptyBudget() {
	return {
		mode: BUDGET_MODE,
		status: 'none',
		token: null,
		escrow: null,
		todoRef: null,
		lockTx: null,
		releaseTx: null,
		lastError: null
	};
}

/**
 * A shape check for what comes out of OrbitDB, where anyone in the write set
 * could have written anything. A malformed budget is ignored, not repaired.
 *
 * `lastError` is any string: a later service may know codes this build does
 * not, and the UI falls back to a generic sentence for those.
 *
 * @param {any} value
 * @returns {value is Budget}
 */
export function isWellFormedBudget(value) {
	if (!value || typeof value !== 'object') return false;
	if (value.mode !== BUDGET_MODE) return false;
	if (!BUDGET_STATUSES.includes(value.status)) return false;
	for (const field of ['token', 'escrow', 'todoRef', 'lockTx', 'releaseTx', 'lastError']) {
		const fieldValue = value[field];
		if (fieldValue !== null && fieldValue !== undefined && typeof fieldValue !== 'string') {
			return false;
		}
	}
	// Past `none`, every state names the escrow it is about.
	if (value.status !== 'none' && value.status !== 'failed' && !value.todoRef) return false;
	return true;
}

/**
 * @param {Budget} budget
 * @param {readonly BudgetStatus[]} allowed
 * @param {string} transition
 */
function assertStatus(budget, allowed, transition) {
	if (!allowed.includes(budget.status)) {
		throw new Error(`Budget cannot ${transition} from status "${budget.status}".`);
	}
}

/**
 * Start locking: from nothing, or again after a failed lock.
 *
 * A retry needs a fresh `todoRef` once a lock reached the chain. Escrows are
 * keyed by creator and `todoRef`, and an underfunded lock leaves one behind
 * (holding an encrypted 0), so the contract refuses the same reference twice.
 *
 * @param {Budget} budget
 * @param {{ todoRef: string, token: string, escrow: string }} target
 * @returns {Budget}
 */
export function startLock(budget, { todoRef, token, escrow }) {
	assertStatus(budget, ['none', 'failed'], 'start locking');
	if (!todoRef) throw new Error('A lock needs a todoRef.');
	if (budget.lockTx && budget.todoRef === todoRef) {
		throw new Error('This todoRef already has an escrow on chain; a retry needs a new one.');
	}
	return {
		...budget,
		status: 'locking',
		token,
		escrow,
		todoRef,
		lockTx: null,
		releaseTx: null,
		lastError: null
	};
}

/**
 * @param {Budget} budget
 * @param {{ lockTx: string }} result
 * @returns {Budget}
 */
export function lockSucceeded(budget, { lockTx }) {
	assertStatus(budget, ['locking'], 'finish locking');
	return { ...budget, status: 'funded', lockTx, lastError: null };
}

/**
 * @param {Budget} budget
 * @param {unknown} error
 * @returns {Budget}
 */
export function lockFailed(budget, error) {
	assertStatus(budget, ['locking'], 'fail locking');
	const lockTx = /** @type {any} */ (error)?.details?.lockTx;
	return {
		...budget,
		status: 'failed',
		lockTx: typeof lockTx === 'string' ? lockTx : null,
		lastError: budgetErrorCode(error)
	};
}

/**
 * @param {Budget} budget
 * @returns {Budget}
 */
export function startRelease(budget) {
	assertStatus(budget, ['funded'], 'start releasing');
	return { ...budget, status: 'releasing', lastError: null };
}

/**
 * @param {Budget} budget
 * @param {{ releaseTx: string }} result
 * @returns {Budget}
 */
export function releaseSucceeded(budget, { releaseTx }) {
	assertStatus(budget, ['releasing'], 'finish releasing');
	return { ...budget, status: 'released', releaseTx, lastError: null };
}

/**
 * A release that did not happen leaves the amount where it was: locked. So the
 * budget goes back to `funded` and carries the reason, rather than to `failed`,
 * which would read as if the money were gone.
 *
 * @param {Budget} budget
 * @param {unknown} error
 * @returns {Budget}
 */
export function releaseFailed(budget, error) {
	assertStatus(budget, ['releasing'], 'fail releasing');
	return { ...budget, status: 'funded', lastError: budgetErrorCode(error) };
}

/**
 * Only the owner, only once the todo is done, only while the amount is locked.
 * The service checks the same on its side; this decides what the UI offers.
 *
 * @param {{ budget: Budget | null | undefined, completed: boolean, isOwner: boolean }} input
 */
export function canReleaseBudget({ budget, completed, isOwner }) {
	return Boolean(isOwner && completed && budget?.status === 'funded');
}

/**
 * While an amount is locked or on its way, the todo is what points at it:
 * deleting the todo loses the reference, and re-delegating it names somebody
 * the escrow does not pay.
 *
 * @param {Budget | null | undefined} budget
 */
export function budgetHoldsTodo(budget) {
	return (
		budget?.status === 'locking' || budget?.status === 'funded' || budget?.status === 'releasing'
	);
}

/**
 * Todos that just paid out to `identityId`, given the statuses seen last time.
 *
 * The first sighting of a todo is not an arrival: opening a list whose budget
 * was released last week must not announce the money as new.
 *
 * @template {{ key: string, budget?: Budget | null, delegation?: { delegateDid: string } | null }} T
 * @param {Record<string, BudgetStatus>} seen
 * @param {T[]} todos
 * @param {string | null | undefined} identityId
 * @returns {{ arrived: T[], seen: Record<string, BudgetStatus> }}
 */
export function paidOutSince(seen, todos, identityId) {
	/** @type {Record<string, BudgetStatus>} */
	const next = {};
	/** @type {T[]} */
	const arrived = [];
	for (const todo of todos) {
		const status = todo.budget?.status;
		if (!status) continue;
		next[todo.key] = status;
		const before = seen[todo.key];
		if (
			before &&
			before !== 'released' &&
			status === 'released' &&
			Boolean(identityId) &&
			todo.delegation?.delegateDid === identityId
		) {
			arrived.push(todo);
		}
	}
	return { arrived, seen: next };
}

const UINT64_MAX = (1n << 64n) - 1n;

/**
 * @param {string} locale
 * @returns {{ decimal: string, group: string }}
 */
export function numberSeparators(locale) {
	const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
	return {
		decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
		group: parts.find((part) => part.type === 'group')?.value ?? ','
	};
}

/**
 * Read an amount somebody typed into base units of the token.
 *
 * People type "500", "500,00", "1.200,50" or "1,200.50", whatever their
 * keyboard's language. Both separators are accepted: when both appear, the
 * last one is the decimal point; when one appears alone, it is a thousands
 * separator only if it is this locale's and three digits follow it — "1.200"
 * is twelve hundred to a German reader and one point two to an English one.
 *
 * @param {string | null | undefined} input
 * @param {{ decimals: number, locale: string }} options
 * @returns {bigint | null} null when empty, malformed, zero, or beyond a `uint64`
 */
export function parseAmount(input, { decimals, locale }) {
	const text = String(input ?? '')
		.trim()
		.replace(/\s/g, '');
	if (!text || !/^[0-9.,]+$/.test(text)) return null;

	const lastDot = text.lastIndexOf('.');
	const lastComma = text.lastIndexOf(',');
	/** @type {'.' | ',' | null} */
	let decimalSeparator = null;
	if (lastDot >= 0 && lastComma >= 0) {
		decimalSeparator = lastDot > lastComma ? '.' : ',';
	} else if (lastDot >= 0 || lastComma >= 0) {
		const separator = lastDot >= 0 ? '.' : ',';
		const occurrences = text.split(separator).length - 1;
		const digitsAfter = text.length - text.lastIndexOf(separator) - 1;
		const grouping =
			occurrences > 1 || (separator === numberSeparators(locale).group && digitsAfter === 3);
		decimalSeparator = grouping ? null : separator;
	}

	const groupSeparator =
		decimalSeparator === '.' ? ',' : decimalSeparator === ',' ? '.' : lastDot >= 0 ? '.' : ',';
	const splitAt = decimalSeparator ? text.lastIndexOf(decimalSeparator) : text.length;
	const wholeRaw = text.slice(0, splitAt);
	const fraction = decimalSeparator ? text.slice(splitAt + 1) : '';

	const groups = wholeRaw.split(groupSeparator);
	if (groups.length > 1) {
		if (!/^\d{1,3}$/.test(groups[0])) return null;
		if (!groups.slice(1).every((group) => /^\d{3}$/.test(group))) return null;
	}
	const whole = groups.join('');
	if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction)) return null;
	if (whole === '' && fraction === '') return null;
	if (fraction.length > decimals) return null;

	const scale = 10n ** BigInt(decimals);
	const units =
		BigInt(whole || '0') * scale +
		BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
	if (units <= 0n || units > UINT64_MAX) return null;
	return units;
}

/**
 * Base units as the locale writes money: at least two decimals, more only when
 * the amount has them. Exact — a bigint never goes through a float here.
 *
 * @param {bigint} units
 * @param {{ decimals: number, locale: string }} options
 */
export function formatAmount(units, { decimals, locale }) {
	const negative = units < 0n;
	const absolute = negative ? -units : units;
	const scale = 10n ** BigInt(decimals);
	const whole = absolute / scale;
	let fraction = (absolute % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
	if (fraction.length < Math.min(2, decimals))
		fraction = fraction.padEnd(Math.min(2, decimals), '0');
	const wholeText = new Intl.NumberFormat(locale).format(whole);
	const separator = numberSeparators(locale).decimal;
	return `${negative ? '-' : ''}${wholeText}${fraction ? `${separator}${fraction}` : ''}`;
}
