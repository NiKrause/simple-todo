import { describe, expect, it } from 'vitest';
import {
	FAKE_AUDITOR_DID,
	createFakeBudgetService,
	createFakeLedger
} from './budget-service-fake.js';

const alice = 'did:key:zAlice';
const bob = 'did:key:zBob';
const mallory = 'did:key:zMallory';
const cUSDT = (/** @type {number} */ whole) => BigInt(whole) * 1_000_000n;

/**
 * Alice, Bob, Mallory and the auditor, each with a service of their own over
 * one shared ledger — the fake's equivalent of four wallets on one chain.
 *
 * @param {{ startingBalance?: bigint, confirm?: (action: string) => Promise<boolean> }} [options]
 */
function world({ startingBalance = cUSDT(1000), confirm } = {}) {
	const ledger = createFakeLedger({ startingBalance });
	let clock = Date.parse('2026-09-16T10:00:00.000Z');
	/** @type {string[]} */
	const prompts = [];
	/** @param {string} did */
	const as = (did) =>
		createFakeBudgetService({
			ledger,
			identity: () => did,
			now: () => clock,
			confirm: async (action) => {
				prompts.push(`${did}:${action}`);
				return confirm ? confirm(action) : true;
			}
		});
	return {
		ledger,
		prompts,
		alice: as(alice),
		bob: as(bob),
		mallory: as(mallory),
		auditor: as(FAKE_AUDITOR_DID),
		/** @param {number} ms */
		advance: (ms) => (clock += ms)
	};
}

/** @param {() => Promise<unknown>} action */
async function codeOf(action) {
	try {
		await action();
	} catch (error) {
		return /** @type {any} */ (error).code;
	}
	return 'no error';
}

describe('the fake budget service', () => {
	it('describes itself as a fake, without a chain and without encryption', () => {
		const { alice } = world();
		expect(alice.info).toMatchObject({
			kind: 'fake',
			network: 'demo',
			chainId: null,
			confidential: false,
			requiresPasskey: false,
			token: { symbol: 'cUSDT', decimals: 6 }
		});
		expect(alice.info.escrow).toMatch(/^0xfa4e[0-9a-f]{36}$/);
	});

	it('salts the todoRef, so a todo key does not lead to its escrow', async () => {
		const { alice } = world();
		const first = await alice.createTodoRef({ todoKey: 'todo_1' });
		const second = await alice.createTodoRef({ todoKey: 'todo_1' });
		expect(first).toMatch(/^0x[0-9a-f]{64}$/);
		expect(second).not.toBe(first);
	});

	it('locks, lets exactly the creator, beneficiary and auditor read, and releases to Bob', async () => {
		const w = world();
		const todoRef = await w.alice.createTodoRef({ todoKey: 'todo_1' });

		const locked = await w.alice.lock({
			todoRef,
			beneficiaryDid: bob,
			amount: cUSDT(500),
			deadline: null
		});
		expect(locked).toMatchObject({ todoRef, lockTx: expect.stringMatching(/^0x[0-9a-f]{64}$/) });
		expect(await w.alice.balance()).toBe(cUSDT(500));

		for (const reader of [w.alice, w.bob, w.auditor]) {
			expect(await reader.decryptAmount({ todoRef, creatorDid: alice })).toBe(cUSDT(500));
		}
		expect(await codeOf(() => w.mallory.decryptAmount({ todoRef, creatorDid: alice }))).toBe(
			'not-allowed'
		);

		// Only the creator can release: Bob's lookup under his own account finds nothing.
		expect(await codeOf(() => w.bob.release({ todoRef }))).toBe('escrow-not-found');

		const released = await w.alice.release({ todoRef });
		expect(released.releaseTx).toMatch(/^0x[0-9a-f]{64}$/);
		expect(await w.bob.balance()).toBe(cUSDT(500));
		expect(await w.alice.balance()).toBe(cUSDT(500));
		expect(await codeOf(() => w.alice.release({ todoRef }))).toBe('escrow-closed');

		// The amount stays readable after the release, as the record of what was locked.
		expect(await w.bob.decryptAmount({ todoRef, creatorDid: alice })).toBe(cUSDT(500));
		expect(w.prompts).toEqual([`${alice}:budget-lock`, `${alice}:budget-release`]);
	});

	it('answers a balance that is too low with an encrypted 0, found by decrypting', async () => {
		const w = world({ startingBalance: cUSDT(100) });
		const todoRef = await w.alice.createTodoRef({ todoKey: 'todo_1' });

		const failure = await w.alice
			.lock({ todoRef, beneficiaryDid: bob, amount: cUSDT(500), deadline: null })
			.then(
				() => null,
				(error) => error
			);
		expect(failure).toMatchObject({
			code: 'insufficient-balance',
			details: { todoRef, lockTx: expect.stringMatching(/^0x[0-9a-f]{64}$/) }
		});
		// Nothing moved, the escrow exists and holds 0, and its reference is spent.
		expect(await w.alice.balance()).toBe(cUSDT(100));
		expect(await w.alice.decryptAmount({ todoRef, creatorDid: alice })).toBe(0n);
		expect(
			await codeOf(() =>
				w.alice.lock({ todoRef, beneficiaryDid: bob, amount: cUSDT(50), deadline: null })
			)
		).toBe('escrow-exists');
	});

	it('changes nothing when the passkey is declined', async () => {
		let allow = false;
		const w = world({ confirm: async () => allow });
		const todoRef = await w.alice.createTodoRef({ todoKey: 'todo_1' });
		const lockAll = () =>
			w.alice.lock({ todoRef, beneficiaryDid: bob, amount: cUSDT(1000), deadline: null });

		expect(await codeOf(lockAll)).toBe('passkey-cancelled');
		expect(await codeOf(() => w.alice.decryptAmount({ todoRef, creatorDid: alice }))).toBe(
			'escrow-not-found'
		);
		// Not even the account was opened: the whole starting balance, and the
		// same todoRef, are still there for the lock that is confirmed.
		expect(await codeOf(() => w.alice.balance())).toBe('unavailable');
		allow = true;
		await lockAll();
		expect(await w.alice.balance()).toBe(0n);
	});

	it('knows no balance for an account this browser has not seen lock or be paid', async () => {
		// In the delegate's own browser the payout happened elsewhere; any number
		// here would be a guess.
		const w = world();
		expect(await codeOf(() => w.bob.balance())).toBe('unavailable');
	});

	it('keeps a declined release locked', async () => {
		let allow = true;
		const w = world({ confirm: async () => allow });
		const todoRef = await w.alice.createTodoRef({ todoKey: 'todo_1' });
		await w.alice.lock({ todoRef, beneficiaryDid: bob, amount: cUSDT(500), deadline: null });

		allow = false;
		expect(await codeOf(() => w.alice.release({ todoRef }))).toBe('passkey-cancelled');
		// Nothing reached Bob, and the escrow is still there to release.
		expect(await codeOf(() => w.bob.balance())).toBe('unavailable');
		allow = true;
		await w.alice.release({ todoRef });
		expect(await w.bob.balance()).toBe(cUSDT(500));
	});

	it('refuses what the contract would refuse', async () => {
		const w = world();
		const todoRef = await w.alice.createTodoRef({ todoKey: 'todo_1' });
		/** @param {Partial<{ beneficiaryDid: string, amount: bigint, deadline: string | null, todoRef: string }>} overrides */
		const lock = (overrides) =>
			codeOf(() =>
				w.alice.lock({
					todoRef,
					beneficiaryDid: bob,
					amount: cUSDT(5),
					deadline: null,
					...overrides
				})
			);

		expect(await lock({ amount: 0n })).toBe('invalid-amount');
		expect(await lock({ amount: 1n << 64n })).toBe('invalid-amount');
		expect(await lock({ beneficiaryDid: alice })).toBe('invalid-beneficiary');
		expect(await lock({ beneficiaryDid: '' })).toBe('invalid-beneficiary');
		expect(await lock({ deadline: '2026-09-15T10:00:00.000Z' })).toBe('invalid-deadline');
		expect(await lock({ deadline: '2028-01-01T00:00:00.000Z' })).toBe('invalid-deadline');
		expect(await lock({ todoRef: `0x${'0'.repeat(64)}` })).toBe('unknown');
		expect(w.prompts).toEqual([]);

		const anonymous = createFakeBudgetService({ ledger: w.ledger, identity: () => null });
		expect(await codeOf(() => anonymous.balance())).toBe('not-allowed');
	});

	it('stops reading once the read key expires, until the passkey renews it', async () => {
		let allow = true;
		const w = world({ confirm: async () => allow });
		const todoRef = await w.alice.createTodoRef({ todoKey: 'todo_1' });
		await w.alice.lock({ todoRef, beneficiaryDid: bob, amount: cUSDT(500), deadline: null });
		expect((await w.bob.readKeyStatus()).state).toBe('valid');

		w.advance(60 * 60 * 1000);
		expect((await w.bob.readKeyStatus()).state).toBe('expired');
		expect(await codeOf(() => w.bob.decryptAmount({ todoRef, creatorDid: alice }))).toBe(
			'read-access-expired'
		);
		expect(await codeOf(() => w.bob.balance())).toBe('read-access-expired');
		expect(await codeOf(() => w.bob.listEscrowsForAuditor())).toBe('read-access-expired');

		allow = false;
		expect(await codeOf(() => w.bob.renewReadKey())).toBe('passkey-cancelled');
		expect((await w.bob.readKeyStatus()).state).toBe('expired');

		allow = true;
		const renewed = await w.bob.renewReadKey();
		expect(renewed.state).toBe('valid');
		expect(Date.parse(renewed.expiresAt ?? '')).toBeGreaterThan(
			Date.parse('2026-09-16T11:00:00.000Z')
		);
		expect(await w.bob.decryptAmount({ todoRef, creatorDid: alice })).toBe(cUSDT(500));
		expect(w.prompts.at(-1)).toBe(`${bob}:budget-read-key`);
	});

	it('lists every escrow for the auditor, newest first, with parties and amounts', async () => {
		const w = world();
		w.auditor.demo.seedExamples();
		w.advance(1000);
		const todoRef = await w.alice.createTodoRef({ todoKey: 'todo_1' });
		await w.alice.lock({ todoRef, beneficiaryDid: bob, amount: cUSDT(42), deadline: null });

		const rows = await w.auditor.listEscrowsForAuditor();
		expect(rows).toHaveLength(4);
		expect(rows[0]).toMatchObject({
			todoRef,
			creator: { did: alice, account: null, label: null },
			beneficiary: { did: bob },
			amount: cUSDT(42),
			status: 'locked'
		});
		expect(
			rows.slice(1).map((row) => [row.creator.label, row.beneficiary.label, row.status])
		).toEqual([
			['Dave', 'Bob', 'locked'],
			['Alice', 'Carol', 'locked'],
			['Alice', 'Bob', 'released']
		]);
	});

	it('lets the demo expire the read key on the spot', async () => {
		const { alice } = world();
		alice.demo.expireReadKey();
		expect((await alice.readKeyStatus()).state).toBe('expired');
	});
});
