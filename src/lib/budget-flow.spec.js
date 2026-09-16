import { describe, expect, it } from 'vitest';
import { finishLock, prepareLock, releaseBudgetOf } from './budget-flow.js';
import { createFakeBudgetService, createFakeLedger } from './budget-service-fake.js';

const alice = 'did:key:zAlice';
const bob = 'did:key:zBob';
const cUSDT = (/** @type {number} */ whole) => BigInt(whole) * 1_000_000n;

/**
 * Alice's service over a fresh ledger, and a record of every budget the flow
 * wrote to her todo, in order.
 *
 * @param {{ startingBalance?: bigint, confirm?: (action: string) => Promise<boolean> }} [options]
 */
function setup({ startingBalance = cUSDT(1000), confirm = async () => true } = {}) {
	const service = createFakeBudgetService({
		ledger: createFakeLedger({ startingBalance }),
		identity: () => alice,
		confirm
	});
	/** @type {Array<{ status: string, lastError: string | null, acceptCompletion: boolean }>} */
	const writes = [];
	/** @type {import('./budget-flow.js').WriteBudget} */
	const writeBudget = async (budget, options = {}) => {
		writes.push({
			status: budget.status,
			lastError: budget.lastError,
			acceptCompletion: options.acceptCompletion === true
		});
	};
	return { service, writes, writeBudget };
}

describe('the budget flows', () => {
	it('lock and release a budget, writing every step to the todo', async () => {
		const { service, writes, writeBudget } = setup();
		const locking = await prepareLock({ todoKey: 'todo_1' }, { service });
		expect(locking.status).toBe('locking');

		const locked = await finishLock(
			locking,
			{ beneficiaryDid: bob, amount: cUSDT(500), deadline: null },
			{ service, writeBudget }
		);
		expect(locked.ok).toBe(true);
		expect(locked.budget).toMatchObject({ status: 'funded', todoRef: locking.todoRef });

		const released = await releaseBudgetOf(locked.budget, { service, writeBudget });
		expect(released.ok).toBe(true);
		expect(released.budget.releaseTx).toMatch(/^0x[0-9a-f]{64}$/);

		expect(writes).toEqual([
			{ status: 'funded', lastError: null, acceptCompletion: false },
			{ status: 'releasing', lastError: null, acceptCompletion: true },
			{ status: 'released', lastError: null, acceptCompletion: false }
		]);
	});

	it('writes a lock from too small a balance as failed, and retries under a new todoRef', async () => {
		const { service, writes, writeBudget } = setup({ startingBalance: cUSDT(100) });
		const locking = await prepareLock({ todoKey: 'todo_1' }, { service });
		const input = { beneficiaryDid: bob, amount: cUSDT(500), deadline: null };

		const failed = await finishLock(locking, input, { service, writeBudget });
		expect(failed).toMatchObject({ ok: false, code: 'insufficient-balance' });
		expect(failed.budget.lockTx).toMatch(/^0x/);
		expect(writes).toEqual([
			{ status: 'failed', lastError: 'insufficient-balance', acceptCompletion: false }
		]);

		const retry = await prepareLock({ todoKey: 'todo_1', previous: failed.budget }, { service });
		expect(retry.todoRef).not.toBe(locking.todoRef);
		const smaller = await finishLock(
			retry,
			{ ...input, amount: cUSDT(80) },
			{ service, writeBudget }
		);
		expect(smaller.ok).toBe(true);
	});

	it('keeps the amount locked when the release passkey is declined', async () => {
		let allow = true;
		const { service, writes, writeBudget } = setup({ confirm: async () => allow });
		const locking = await prepareLock({ todoKey: 'todo_1' }, { service });
		const locked = await finishLock(
			locking,
			{ beneficiaryDid: bob, amount: cUSDT(500), deadline: null },
			{ service, writeBudget }
		);

		allow = false;
		const declined = await releaseBudgetOf(locked.budget, { service, writeBudget });
		expect(declined).toMatchObject({ ok: false, code: 'passkey-cancelled' });
		expect(declined.budget.status).toBe('funded');
		expect(writes.slice(1)).toEqual([
			{ status: 'releasing', lastError: null, acceptCompletion: true },
			{ status: 'funded', lastError: 'passkey-cancelled', acceptCompletion: false }
		]);
	});
});
