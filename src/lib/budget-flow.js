/**
 * Locking and releasing a todo's budget, step by step (escrow01).
 *
 * Each step is written to the todo before the next one starts, so the list
 * shows what is under way — "being locked" while the passkey is up — and a
 * reload in the middle leaves a status and a `todoRef` to reconcile from,
 * rather than nothing.
 *
 * The service and the write are passed in, so the flows run against the fake
 * service and an array in the unit tests.
 */

import {
	emptyBudget,
	lockFailed,
	lockSucceeded,
	releaseFailed,
	releaseSucceeded,
	startLock,
	startRelease
} from './budget.js';

/** @typedef {import('./budget.js').Budget} Budget */
/** @typedef {import('./budget-service.js').BudgetService} BudgetService */
/**
 * @typedef {(budget: Budget, options?: { acceptCompletion?: boolean }) => Promise<void>} WriteBudget
 *   `acceptCompletion` marks the write that starts a release: the owner takes
 *   the delegate's completion into the todo's own entry.
 */
/**
 * @typedef {{ ok: true, budget: Budget } | { ok: false, budget: Budget, code: string }} BudgetOutcome
 */

/**
 * The budget a todo starts locking with: a fresh `todoRef` for the escrow.
 *
 * @param {{ todoKey: string, previous?: Budget | null }} input
 * @param {{ service: BudgetService }} deps
 * @returns {Promise<Budget>}
 */
export async function prepareLock({ todoKey, previous = null }, { service }) {
	const todoRef = await service.createTodoRef({ todoKey });
	return startLock(previous ?? emptyBudget(), {
		todoRef,
		token: service.info.token.address,
		escrow: service.info.escrow
	});
}

/**
 * Lock the amount for a budget that is already written as `locking`, and
 * write what came of it.
 *
 * @param {Budget} locking
 * @param {{ beneficiaryDid: string, amount: bigint, deadline: string | null }} input
 * @param {{ service: BudgetService, writeBudget: WriteBudget }} deps
 * @returns {Promise<BudgetOutcome>}
 */
export async function finishLock(
	locking,
	{ beneficiaryDid, amount, deadline },
	{ service, writeBudget }
) {
	if (!locking.todoRef) throw new Error('A budget being locked has a todoRef.');
	/** @type {Budget} */
	let next;
	try {
		const result = await service.lock({
			todoRef: locking.todoRef,
			beneficiaryDid,
			amount,
			deadline
		});
		next = lockSucceeded(locking, result);
	} catch (error) {
		next = lockFailed(locking, error);
	}
	await writeBudget(next);
	return next.status === 'funded'
		? { ok: true, budget: next }
		: { ok: false, budget: next, code: next.lastError ?? 'unknown' };
}

/**
 * Release a funded budget to the delegate.
 *
 * @param {Budget} funded
 * @param {{ service: BudgetService, writeBudget: WriteBudget }} deps
 * @returns {Promise<BudgetOutcome>}
 */
export async function releaseBudgetOf(funded, { service, writeBudget }) {
	const releasing = startRelease(funded);
	if (!releasing.todoRef) throw new Error('A funded budget has a todoRef.');
	await writeBudget(releasing, { acceptCompletion: true });
	/** @type {Budget} */
	let next;
	try {
		next = releaseSucceeded(releasing, await service.release({ todoRef: releasing.todoRef }));
	} catch (error) {
		next = releaseFailed(releasing, error);
	}
	await writeBudget(next);
	return next.status === 'released'
		? { ok: true, budget: next }
		: { ok: false, budget: next, code: next.lastError ?? 'unknown' };
}
