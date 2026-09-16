/**
 * Budgets as this app uses them (escrow01): the session's budget service, what
 * it has decrypted, and the flows that lock and release a todo's budget and
 * write each step to the todo.
 *
 * Amounts live here in memory and nowhere else on this side. The todo in
 * OrbitDB carries status and references only; an amount somebody typed is
 * kept until the chain holds it, and what is shown after that comes from the
 * service's decrypt.
 */

import { derived, get, readable, writable } from 'svelte/store';
import { budgetErrorCode, canReleaseBudget, isWellFormedBudget, paidOutSince } from './budget.js';
import { finishLock, prepareLock, releaseBudgetOf } from './budget-flow.js';
import { createBudgetService } from './budget-service.js';
import { confirmDelegatedWrite } from './delegated-write-auth.js';
import { translate } from './i18n/index.js';
import {
	addTodo,
	createTodoKey,
	ownIdentityIdStore,
	setTodoBudget,
	todosStore
} from './db-actions.js';

/** @typedef {import('./budget.js').Budget} Budget */
/** @typedef {import('./db-actions.js').TodoItem} TodoItem */
/**
 * @typedef {{ state: 'idle' | 'decrypting' | 'ready' | 'hidden' | 'expired', units: bigint | null }} AmountState
 *   `hidden`: this session cannot read it — not a party to the escrow, or an
 *   escrow this browser never saw (the fake keeps them in memory only).
 */
/**
 * @typedef {{ action: 'lock' | 'release', code: string, todoKey: string }} BudgetNotice
 */

/** @type {AmountState} */
const IDLE = { state: 'idle', units: null };
/** @type {AmountState} */
const DECRYPTING = { state: 'decrypting', units: null };
/** @type {AmountState} */
const HIDDEN = { state: 'hidden', units: null };
/** @type {AmountState} */
const EXPIRED = { state: 'expired', units: null };

export const budgetService = createBudgetService({
	kind: import.meta.env.VITE_BUDGET_SERVICE,
	identity: () => get(ownIdentityIdStore),
	// The passkey prompt a delegated write asks for, shown by the same badge.
	confirm: (action) => confirmDelegatedWrite(action),
	// Roughly what a transaction and a decryption take, so the states between
	// are visible rather than a flicker.
	fake: { delayMs: 1200, decryptDelayMs: 900 }
});

export const budgetInfo = budgetService.info;

// ---------------------------------------------------------------------------
// Amounts

/** What somebody typed, by todo key, until the escrow holds it. */
const pendingAmounts = writable(/** @type {Record<string, bigint>} */ ({}));

/** @param {string} todoKey @param {bigint} amount */
function rememberAmount(todoKey, amount) {
	pendingAmounts.update((all) => ({ ...all, [todoKey]: amount }));
}

/** @param {string} todoKey */
function forgetAmount(todoKey) {
	pendingAmounts.update((all) => {
		const next = { ...all };
		delete next[todoKey];
		return next;
	});
}

/** Decrypted amounts, by creator and `todoRef`. */
const amounts = writable(/** @type {Record<string, AmountState>} */ ({}));
/** @type {Map<string, Promise<AmountState>>} */
const decryptsInFlight = new Map();

/** @param {string} creatorDid @param {string} todoRef */
const amountKey = (creatorDid, todoRef) => `${creatorDid}\n${todoRef.toLowerCase()}`;

/** @param {string} key @param {AmountState} state */
function setAmount(key, state) {
	amounts.update((all) => ({ ...all, [key]: state }));
}

/**
 * The amount of `creatorDid`'s escrow `todoRef`, decrypted once per session.
 *
 * @param {string} creatorDid
 * @param {string} todoRef
 * @returns {Promise<AmountState>}
 */
export function readAmount(creatorDid, todoRef) {
	const key = amountKey(creatorDid, todoRef);
	const known = get(amounts)[key];
	if (known && known.state !== 'decrypting') return Promise.resolve(known);
	const running = decryptsInFlight.get(key);
	if (running) return running;

	setAmount(key, DECRYPTING);
	const request = (async () => {
		/** @type {AmountState} */
		let state;
		try {
			state = { state: 'ready', units: await budgetService.decryptAmount({ todoRef, creatorDid }) };
		} catch (error) {
			const expired = budgetErrorCode(error) === 'read-access-expired';
			if (expired) void refreshReadKey();
			state = expired ? EXPIRED : HIDDEN;
		}
		setAmount(key, state);
		decryptsInFlight.delete(key);
		return state;
	})();
	decryptsInFlight.set(key, request);
	return request;
}

/**
 * The amount a todo's budget chip shows.
 *
 * While a budget is being locked there is nothing on chain to decrypt, and a
 * failed lock holds 0: both show what was typed in this browser, if it was.
 *
 * @param {{ todoKey: string, creatorDid: string | null, budget: Budget | null }} input
 * @returns {import('svelte/store').Readable<AmountState>}
 */
export function amountFor({ todoKey, creatorDid, budget }) {
	if (!budget || budget.status === 'none') return readable(IDLE);
	const { todoRef } = budget;
	if (budget.status === 'locking' || budget.status === 'failed' || !todoRef || !creatorDid) {
		return derived(pendingAmounts, ($pending) =>
			$pending[todoKey] === undefined
				? HIDDEN
				: /** @type {AmountState} */ ({ state: 'ready', units: $pending[todoKey] })
		);
	}
	const key = amountKey(creatorDid, todoRef);
	return derived(amounts, ($amounts) => {
		const entry = $amounts[key];
		if (!entry) queueMicrotask(() => void readAmount(creatorDid, todoRef));
		return entry ?? DECRYPTING;
	});
}

// ---------------------------------------------------------------------------
// Read access and balance

export const readKeyStore = writable(
	/** @type {import('./budget-service.js').ReadKeyStatus | null} */ (null)
);

export async function refreshReadKey() {
	try {
		readKeyStore.set(await budgetService.readKeyStatus());
	} catch (error) {
		console.warn('Read key status unavailable:', error);
	}
}

/** @returns {Promise<{ ok: boolean, code?: string }>} */
export async function renewReadAccess() {
	try {
		readKeyStore.set(await budgetService.renewReadKey());
	} catch (error) {
		return { ok: false, code: budgetErrorCode(error) };
	}
	// What could not be read a moment ago can be now.
	amounts.update((all) =>
		Object.fromEntries(Object.entries(all).filter(([, entry]) => entry.state !== 'expired'))
	);
	void refreshBalance();
	return { ok: true };
}

export const balanceStore = writable(/** @type {AmountState} */ (IDLE));
let balanceRequests = 0;

export async function refreshBalance() {
	const request = ++balanceRequests;
	// Keep showing the last balance while a newer one is decrypted.
	balanceStore.update((current) => (current.state === 'ready' ? current : DECRYPTING));
	/** @type {AmountState} */
	let next;
	try {
		next = { state: 'ready', units: await budgetService.balance() };
	} catch (error) {
		const expired = budgetErrorCode(error) === 'read-access-expired';
		if (expired) void refreshReadKey();
		next = expired ? EXPIRED : HIDDEN;
	}
	if (request === balanceRequests) balanceStore.set(next);
}

/** How many amounts are being decrypted right now, the balance included. */
export const decryptingCount = derived(
	[amounts, balanceStore],
	([$amounts, $balance]) =>
		Object.values($amounts).filter((entry) => entry.state === 'decrypting').length +
		($balance.state === 'decrypting' ? 1 : 0)
);

// ---------------------------------------------------------------------------
// Flows

/** The outcome of the last lock or release that did not go through. */
export const budgetNoticeStore = writable(/** @type {BudgetNotice | null} */ (null));

export function dismissBudgetNotice() {
	budgetNoticeStore.set(null);
}

/**
 * @param {TodoItem[]} todos
 * @param {string} todoKey
 */
const findTodo = (todos, todoKey) => todos.find((todo) => todo.key === todoKey);

/** @param {TodoItem | undefined} todo @param {string | null} identityId */
function releasable(todo, identityId) {
	return Boolean(
		todo &&
			isWellFormedBudget(todo.budget) &&
			canReleaseBudget({
				budget: todo.budget,
				completed: todo.completed,
				isOwner: Boolean(identityId) && todo.createdByIdentity === identityId
			})
	);
}

/** Whether "confirm again" on the current notice has anything to retry. */
export const budgetNoticeRetryable = derived(
	[budgetNoticeStore, todosStore, pendingAmounts, ownIdentityIdStore],
	([$notice, $todos, $pending, $identityId]) => {
		if (!$notice) return false;
		const todo = findTodo($todos, $notice.todoKey);
		if ($notice.action === 'release') return releasable(todo, $identityId);
		return (
			todo?.budget?.status === 'failed' &&
			$pending[$notice.todoKey] !== undefined &&
			Boolean(todo.delegation?.delegateDid)
		);
	}
);

/**
 * @param {string} todoKey
 * @param {Budget} locking
 * @param {{ beneficiaryDid: string, amount: bigint, deadline: string | null }} input
 */
async function lockBudget(todoKey, locking, input) {
	budgetNoticeStore.set(null);
	try {
		const outcome = await finishLock(locking, input, {
			service: budgetService,
			writeBudget: (budget) => setTodoBudget(todoKey, budget)
		});
		if (outcome.ok) forgetAmount(todoKey);
		else budgetNoticeStore.set({ action: 'lock', code: outcome.code, todoKey });
	} catch (error) {
		console.error('The budget lock could not be recorded:', error);
		budgetNoticeStore.set({ action: 'lock', code: 'unknown', todoKey });
	} finally {
		void refreshBalance();
	}
}

/**
 * Create a delegated todo that is already "being locked", then lock its
 * budget. Resolves once the todo is written; the lock goes on in the
 * background and reports through the todo's status and `budgetNoticeStore`.
 *
 * @param {{ text: string, delegateDid: string, expiresAt: string | null, amount: bigint }} input
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function addTodoWithBudget({ text, delegateDid, expiresAt, amount }) {
	const todoKey = createTodoKey();
	/** @type {Budget} */
	let locking;
	try {
		locking = await prepareLock({ todoKey }, { service: budgetService });
	} catch (error) {
		// The service's own words are the reason; the sentence around them is the reader's.
		return {
			ok: false,
			error: translate('errors.addFailed', {
				reason: error instanceof Error ? error.message : String(error)
			})
		};
	}
	rememberAmount(todoKey, amount);
	const added = await addTodo(
		text,
		null,
		{ delegateDid, expiresAt },
		{ key: todoKey, budget: locking }
	);
	if (!added.ok) {
		forgetAmount(todoKey);
		return added;
	}
	void lockBudget(todoKey, locking, { beneficiaryDid: delegateDid, amount, deadline: expiresAt });
	return { ok: true };
}

/**
 * Release a completed todo's budget to its delegate. Owner only; the service
 * refuses anybody else as well.
 *
 * @param {string} todoKey
 * @returns {Promise<{ ok: boolean }>}
 */
export async function releaseTodoBudget(todoKey) {
	const todo = findTodo(get(todosStore), todoKey);
	const budget = todo?.budget;
	if (!releasable(todo, get(ownIdentityIdStore)) || !isWellFormedBudget(budget)) {
		budgetNoticeStore.set({ action: 'release', code: 'not-allowed', todoKey });
		return { ok: false };
	}
	budgetNoticeStore.set(null);
	try {
		const outcome = await releaseBudgetOf(budget, {
			service: budgetService,
			writeBudget: (next, options) => setTodoBudget(todoKey, next, options)
		});
		if (!outcome.ok) budgetNoticeStore.set({ action: 'release', code: outcome.code, todoKey });
		return { ok: outcome.ok };
	} catch (error) {
		console.error('The budget release could not be recorded:', error);
		budgetNoticeStore.set({ action: 'release', code: 'unknown', todoKey });
		return { ok: false };
	} finally {
		void refreshBalance();
	}
}

/** "Confirm again": repeat the lock or release the current notice is about. */
export async function retryBudgetNotice() {
	const notice = get(budgetNoticeStore);
	if (!notice) return;
	if (notice.action === 'release') {
		await releaseTodoBudget(notice.todoKey);
		return;
	}
	const todo = findTodo(get(todosStore), notice.todoKey);
	const amount = get(pendingAmounts)[notice.todoKey];
	const beneficiaryDid = todo?.delegation?.delegateDid;
	if (!todo || !isWellFormedBudget(todo.budget) || todo.budget.status !== 'failed') return;
	if (amount === undefined || !beneficiaryDid) return;
	budgetNoticeStore.set(null);
	try {
		// A new todoRef: an underfunded lock left an escrow under the old one.
		const locking = await prepareLock(
			{ todoKey: todo.key, previous: todo.budget },
			{ service: budgetService }
		);
		await setTodoBudget(todo.key, locking);
		await lockBudget(todo.key, locking, {
			beneficiaryDid,
			amount,
			deadline: todo.delegation?.expiresAt ?? null
		});
	} catch (error) {
		console.error('The budget lock could not be retried:', error);
		budgetNoticeStore.set({ action: 'lock', code: 'unknown', todoKey: todo.key });
	}
}

/**
 * Call `onArrival` for every todo whose budget is paid out to this session
 * while it watches. Returns the unsubscribe function.
 *
 * @param {(todo: TodoItem) => void} onArrival
 */
export function watchPayouts(onArrival) {
	/** @type {Record<string, import('./budget.js').BudgetStatus>} */
	let seen = {};
	return derived([todosStore, ownIdentityIdStore], (values) => values).subscribe(
		([$todos, $identityId]) => {
			const result = paidOutSince(seen, $todos, $identityId);
			seen = result.seen;
			for (const todo of result.arrived) onArrival(todo);
		}
	);
}

// The fake's levers, for showing states that otherwise take an hour to reach:
// `simpleTodoBudgetDemo.expireReadKey()` in the console.
if (typeof window !== 'undefined' && budgetService.info.kind === 'fake') {
	/** @type {any} */ (window).simpleTodoBudgetDemo = {
		expireReadKey() {
			budgetService.demo.expireReadKey();
			amounts.set({});
			void refreshReadKey();
			void refreshBalance();
		},
		seedExamples() {
			budgetService.demo.seedExamples();
		}
	};
}
