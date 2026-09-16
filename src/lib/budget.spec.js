import { describe, expect, it } from 'vitest';
import {
	BudgetError,
	budgetErrorCode,
	budgetHoldsTodo,
	canReleaseBudget,
	emptyBudget,
	formatAmount,
	isWellFormedBudget,
	lockFailed,
	lockSucceeded,
	paidOutSince,
	parseAmount,
	releaseFailed,
	releaseSucceeded,
	startLock,
	startRelease
} from './budget.js';

const REF_A = `0x${'a'.repeat(64)}`;
const REF_B = `0x${'b'.repeat(64)}`;
const target = { todoRef: REF_A, token: '0xtoken', escrow: '0xescrow' };
const cUSDT = { decimals: 6, locale: 'de' };
const units = (/** @type {string} */ whole) => BigInt(whole) * 1_000_000n;

describe('the budget lifecycle', () => {
	it('walks none → locking → funded → releasing → released, keeping what each step recorded', () => {
		const locking = startLock(emptyBudget(), target);
		expect(locking).toMatchObject({
			mode: 'zama-confidential',
			status: 'locking',
			todoRef: REF_A,
			token: '0xtoken',
			escrow: '0xescrow',
			lockTx: null
		});

		const funded = lockSucceeded(locking, { lockTx: '0xlock' });
		expect(funded).toMatchObject({ status: 'funded', lockTx: '0xlock', lastError: null });

		const releasing = startRelease(funded);
		expect(releasing.status).toBe('releasing');

		const released = releaseSucceeded(releasing, { releaseTx: '0xrelease' });
		expect(released).toEqual({
			mode: 'zama-confidential',
			status: 'released',
			token: '0xtoken',
			escrow: '0xescrow',
			todoRef: REF_A,
			lockTx: '0xlock',
			releaseTx: '0xrelease',
			lastError: null
		});
	});

	it('never mutates the budget it was given', () => {
		const none = emptyBudget();
		const locking = startLock(none, target);
		lockSucceeded(locking, { lockTx: '0xlock' });
		expect(none.status).toBe('none');
		expect(locking.status).toBe('locking');
	});

	it('refuses transitions the lifecycle does not have', () => {
		const funded = lockSucceeded(startLock(emptyBudget(), target), { lockTx: '0xlock' });
		const released = releaseSucceeded(startRelease(funded), { releaseTx: '0xrelease' });

		expect(() => startRelease(emptyBudget())).toThrow(/from status "none"/);
		expect(() => startRelease(startLock(emptyBudget(), target))).toThrow(/locking/);
		expect(() => startRelease(released)).toThrow(/released/);
		expect(() => lockSucceeded(funded, { lockTx: '0x' })).toThrow(/funded/);
		expect(() => startLock(funded, { ...target, todoRef: REF_B })).toThrow(/funded/);
		expect(() => releaseSucceeded(funded, { releaseTx: '0x' })).toThrow(/funded/);
		expect(() => startLock(emptyBudget(), { ...target, todoRef: '' })).toThrow(/todoRef/);
	});

	it('records why a lock failed, and the transaction when one was mined', () => {
		const locking = startLock(emptyBudget(), target);

		const underfunded = lockFailed(
			locking,
			new BudgetError('insufficient-balance', 'encrypted 0', { lockTx: '0xzero' })
		);
		expect(underfunded).toMatchObject({
			status: 'failed',
			lastError: 'insufficient-balance',
			lockTx: '0xzero',
			todoRef: REF_A
		});

		const cancelled = lockFailed(locking, new BudgetError('passkey-cancelled'));
		expect(cancelled).toMatchObject({
			status: 'failed',
			lastError: 'passkey-cancelled',
			lockTx: null
		});

		expect(lockFailed(locking, new Error('rpc down')).lastError).toBe('unknown');
	});

	it('retries a failed lock only under a new todoRef once an escrow reached the chain', () => {
		const locking = startLock(emptyBudget(), target);
		const underfunded = lockFailed(
			locking,
			new BudgetError('insufficient-balance', 'encrypted 0', { lockTx: '0xzero' })
		);
		expect(() => startLock(underfunded, target)).toThrow(/new one/);
		expect(startLock(underfunded, { ...target, todoRef: REF_B })).toMatchObject({
			status: 'locking',
			todoRef: REF_B,
			lockTx: null,
			lastError: null
		});

		// Nothing was sent when the passkey was declined, so the reference is unused.
		const cancelled = lockFailed(locking, new BudgetError('passkey-cancelled'));
		expect(startLock(cancelled, target).status).toBe('locking');
	});

	it('puts a release that did not happen back to funded, with the reason', () => {
		const funded = lockSucceeded(startLock(emptyBudget(), target), { lockTx: '0xlock' });
		const back = releaseFailed(startRelease(funded), new BudgetError('passkey-cancelled'));
		expect(back).toMatchObject({
			status: 'funded',
			lastError: 'passkey-cancelled',
			releaseTx: null
		});
		expect(startRelease(back).lastError).toBeNull();
	});
});

describe('budget guards', () => {
	const funded = lockSucceeded(startLock(emptyBudget(), target), { lockTx: '0xlock' });

	it('offers the release to the owner of a completed, funded todo and nobody else', () => {
		expect(canReleaseBudget({ budget: funded, completed: true, isOwner: true })).toBe(true);
		expect(canReleaseBudget({ budget: funded, completed: false, isOwner: true })).toBe(false);
		expect(canReleaseBudget({ budget: funded, completed: true, isOwner: false })).toBe(false);
		expect(canReleaseBudget({ budget: startRelease(funded), completed: true, isOwner: true })).toBe(
			false
		);
		expect(canReleaseBudget({ budget: null, completed: true, isOwner: true })).toBe(false);
	});

	it('holds the todo while an amount is locked or on its way', () => {
		expect(budgetHoldsTodo(startLock(emptyBudget(), target))).toBe(true);
		expect(budgetHoldsTodo(funded)).toBe(true);
		expect(budgetHoldsTodo(startRelease(funded))).toBe(true);
		expect(budgetHoldsTodo(emptyBudget())).toBe(false);
		expect(budgetHoldsTodo(lockFailed(startLock(emptyBudget(), target), new Error('x')))).toBe(
			false
		);
		expect(budgetHoldsTodo(null)).toBe(false);
	});

	it('maps unknown failures to "unknown"', () => {
		expect(budgetErrorCode(new BudgetError('read-access-expired'))).toBe('read-access-expired');
		expect(budgetErrorCode({ code: 'ACTION_REJECTED' })).toBe('unknown');
		expect(budgetErrorCode(undefined)).toBe('unknown');
	});
});

describe('isWellFormedBudget', () => {
	it('accepts what the lifecycle produces', () => {
		expect(isWellFormedBudget(emptyBudget())).toBe(true);
		expect(isWellFormedBudget(startLock(emptyBudget(), target))).toBe(true);
	});

	it('refuses what somebody with write access could have put there instead', () => {
		expect(isWellFormedBudget(null)).toBe(false);
		expect(isWellFormedBudget({ ...emptyBudget(), mode: 'plaintext' })).toBe(false);
		expect(isWellFormedBudget({ ...emptyBudget(), status: 'paid' })).toBe(false);
		expect(isWellFormedBudget({ ...emptyBudget(), lockTx: 42 })).toBe(false);
		expect(isWellFormedBudget({ ...emptyBudget(), status: 'funded' })).toBe(false);
	});
});

describe('paidOutSince', () => {
	const bob = 'did:key:zBob';
	/** @param {'funded' | 'released'} status @param {string} [delegateDid] */
	const todo = (status, delegateDid = bob) => ({
		key: 'todo_1',
		delegation: { delegateDid },
		budget: { ...emptyBudget(), status, todoRef: REF_A }
	});

	it('announces a release the delegate watched happen', () => {
		const first = paidOutSince({}, [todo('funded')], bob);
		expect(first.arrived).toEqual([]);
		const second = paidOutSince(first.seen, [todo('released')], bob);
		expect(second.arrived.map((t) => t.key)).toEqual(['todo_1']);
		expect(paidOutSince(second.seen, [todo('released')], bob).arrived).toEqual([]);
	});

	it('does not announce old releases, or releases to somebody else', () => {
		expect(paidOutSince({}, [todo('released')], bob).arrived).toEqual([]);
		const seen = paidOutSince({}, [todo('funded', 'did:key:zCarol')], bob).seen;
		expect(paidOutSince(seen, [todo('released', 'did:key:zCarol')], bob).arrived).toEqual([]);
	});
});

describe('amounts', () => {
	it('reads what people type, in either language', () => {
		expect(parseAmount('500', cUSDT)).toBe(units('500'));
		expect(parseAmount('500,00', cUSDT)).toBe(units('500'));
		expect(parseAmount('500.5', cUSDT)).toBe(500_500_000n);
		expect(parseAmount('1.200,50', cUSDT)).toBe(1_200_500_000n);
		expect(parseAmount('1,200.50', cUSDT)).toBe(1_200_500_000n);
		expect(parseAmount(' 1 200,5 ', cUSDT)).toBe(1_200_500_000n);
		expect(parseAmount('0,000001', cUSDT)).toBe(1n);
	});

	it('reads a lone separator before three digits the way the locale does', () => {
		expect(parseAmount('1.200', { decimals: 6, locale: 'de' })).toBe(units('1200'));
		expect(parseAmount('1.200', { decimals: 6, locale: 'en' })).toBe(1_200_000n);
		expect(parseAmount('1,200', { decimals: 6, locale: 'en' })).toBe(units('1200'));
		expect(parseAmount('1,200', { decimals: 6, locale: 'de' })).toBe(1_200_000n);
	});

	it('refuses what is not an amount', () => {
		for (const input of ['', '   ', '0', '0,00', '-5', 'abc', '1.2.3', '12.00,5', '1,0000001']) {
			expect(parseAmount(input, cUSDT), input).toBeNull();
		}
		expect(parseAmount(null, cUSDT)).toBeNull();
		// A euint64 holds at most 18446744073709.551615 of a six-decimal token.
		expect(parseAmount('18446744073709,551615', cUSDT)).toBe((1n << 64n) - 1n);
		expect(parseAmount('18446744073709,551616', cUSDT)).toBeNull();
	});

	it('writes amounts exactly, with two decimals or as many as they have', () => {
		expect(formatAmount(units('500'), cUSDT)).toBe('500,00');
		expect(formatAmount(1_200_000_000n, cUSDT)).toBe('1.200,00');
		expect(formatAmount(1_200_000_000n, { decimals: 6, locale: 'en' })).toBe('1,200.00');
		expect(formatAmount(1_500_000n, cUSDT)).toBe('1,50');
		expect(formatAmount(1n, cUSDT)).toBe('0,000001');
		expect(formatAmount(0n, cUSDT)).toBe('0,00');
		expect(formatAmount((1n << 64n) - 1n, { decimals: 6, locale: 'en' })).toBe(
			'18,446,744,073,709.551615'
		);
	});
});
