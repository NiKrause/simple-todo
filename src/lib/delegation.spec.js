import { describe, expect, it } from 'vitest';
import {
	applyDelegationActions,
	buildDelegationAction,
	buildDelegationActionKey,
	delegationStatus,
	isDelegationActiveFor,
	isWellFormedDelegationAction
} from './delegation.js';

const alice = 'did:key:zAlice';
const bob = 'did:key:zBob';
const mallory = 'did:key:zMallory';

const T0 = Date.parse('2026-09-01T10:00:00.000Z');
const at = (/** @type {number} */ minutes) => new Date(T0 + minutes * 60_000).toISOString();

/** @param {Partial<any>} [overrides] @returns {any} */
function todo(overrides = {}) {
	return {
		key: 'todo_1',
		text: 'write the chapter',
		completed: false,
		createdByIdentity: alice,
		updatedAt: at(0),
		delegation: {
			delegateDid: bob,
			grantedBy: alice,
			grantedAt: at(0),
			expiresAt: null,
			revokedAt: null
		},
		...overrides
	};
}

/** @param {string} did @param {number} minutes @param {Partial<any>} [overrides] @returns {any} */
function completedBy(did, minutes, overrides = {}) {
	return {
		type: 'delegation-action',
		action: 'set-completed',
		taskKey: 'todo_1',
		delegateDid: did,
		performedBy: did,
		performedAt: at(minutes),
		setCompleted: true,
		expiresAt: null,
		...overrides
	};
}

describe('isDelegationActiveFor', () => {
	it('is true only for the delegate of an unrevoked, unexpired delegation', () => {
		expect(isDelegationActiveFor(todo(), bob, T0)).toBe(true);
		expect(isDelegationActiveFor(todo(), mallory, T0)).toBe(false);
		expect(isDelegationActiveFor(todo(), alice, T0)).toBe(false);
		expect(isDelegationActiveFor(todo({ delegation: null }), bob, T0)).toBe(false);
		expect(isDelegationActiveFor(todo(), null, T0)).toBe(false);
	});

	it('ends with revoke', () => {
		const revoked = todo({ delegation: { ...todo().delegation, revokedAt: at(5) } });
		expect(isDelegationActiveFor(revoked, bob, T0 + 10 * 60_000)).toBe(false);
	});

	it('ends with expiry, and not a moment before', () => {
		const expiring = todo({ delegation: { ...todo().delegation, expiresAt: at(30) } });
		expect(isDelegationActiveFor(expiring, bob, T0 + 29 * 60_000)).toBe(true);
		expect(isDelegationActiveFor(expiring, bob, T0 + 31 * 60_000)).toBe(false);
	});
});

describe('delegationStatus', () => {
	it('names the four states', () => {
		expect(delegationStatus(null)).toBe('none');
		expect(delegationStatus(todo().delegation, T0)).toBe('active');
		expect(delegationStatus({ ...todo().delegation, revokedAt: at(1) }, T0)).toBe('revoked');
		expect(delegationStatus({ ...todo().delegation, expiresAt: at(1) }, T0 + 120_000)).toBe(
			'expired'
		);
	});
});

describe('action keys and envelopes', () => {
	it('builds the key shape the access controller parses, DID URI-encoded', () => {
		const key = buildDelegationActionKey('todo_1', bob);
		const match = /^delegation-action\/([^/]+)\/([^/]+)\/[^/]+$/.exec(key);
		expect(match).not.toBeNull();
		expect(match?.[1]).toBe('todo_1');
		expect(decodeURIComponent(match?.[2] ?? '')).toBe(bob);
	});

	it('two keys for the same todo and delegate never collide', () => {
		expect(buildDelegationActionKey('todo_1', bob)).not.toBe(
			buildDelegationActionKey('todo_1', bob)
		);
	});

	it('builds envelopes that pass its own shape check and carry the expiry', () => {
		const target = { taskKey: 'todo_1', delegateDid: bob, expiresAt: at(30) };
		const done = buildDelegationAction(target, { setCompleted: true });
		const rename = buildDelegationAction(target, { patch: { text: 'renamed' } });
		expect(isWellFormedDelegationAction(done)).toBe(true);
		expect(isWellFormedDelegationAction(rename)).toBe(true);
		expect(done.expiresAt).toBe(at(30));
		expect(done.action).toBe('set-completed');
		expect(rename.action).toBe('patch-fields');
	});

	it('rejects patches outside text/description and non-boolean completions', () => {
		expect(isWellFormedDelegationAction(completedBy(bob, 1, { setCompleted: 'yes' }))).toBe(false);
		expect(
			isWellFormedDelegationAction(
				completedBy(bob, 1, { action: 'patch-fields', patch: { delegation: null } })
			)
		).toBe(false);
		expect(
			isWellFormedDelegationAction(completedBy(bob, 1, { action: 'patch-fields', patch: {} }))
		).toBe(false);
		expect(isWellFormedDelegationAction({ type: 'todo' })).toBe(false);
	});
});

describe('applyDelegationActions', () => {
	it("applies the delegate's completion and rename, latest last", () => {
		const [merged] = applyDelegationActions(
			[todo()],
			[
				completedBy(bob, 2),
				completedBy(bob, 1, { action: 'patch-fields', patch: { text: 'first' } }),
				completedBy(bob, 3, { action: 'patch-fields', patch: { text: 'final' } })
			],
			T0 + 10 * 60_000
		);
		expect(merged.completed).toBe(true);
		expect(merged.text).toBe('final');
		expect(merged.updatedBy).toBe(bob);
		expect(merged.updatedAt).toBe(at(3));
	});

	it('ignores actions signed by someone the todo does not delegate to', () => {
		const [merged] = applyDelegationActions([todo()], [completedBy(mallory, 1)], T0 + 60_000);
		expect(merged.completed).toBe(false);
	});

	it('ignores actions once the delegation is revoked — even earlier ones', () => {
		const revoked = todo({
			updatedAt: at(5),
			delegation: { ...todo().delegation, revokedAt: at(5) }
		});
		const [merged] = applyDelegationActions([revoked], [completedBy(bob, 1)], T0 + 10 * 60_000);
		expect(merged.completed).toBe(false);
	});

	it('ignores actions once the delegation has expired', () => {
		const expiring = todo({ delegation: { ...todo().delegation, expiresAt: at(30) } });
		expect(
			applyDelegationActions([expiring], [completedBy(bob, 1)], T0 + 60_000)[0].completed
		).toBe(true);
		expect(
			applyDelegationActions([expiring], [completedBy(bob, 1)], T0 + 31 * 60_000)[0].completed
		).toBe(false);
	});

	it("lets the owner's later write win over an older delegate action", () => {
		// Bob completed at +1, Alice then re-opened the todo at +2.
		const reopened = todo({ completed: false, updatedAt: at(2) });
		const [merged] = applyDelegationActions([reopened], [completedBy(bob, 1)], T0 + 10 * 60_000);
		expect(merged.completed).toBe(false);
	});

	it('drops actions for unknown todos and leaves other todos untouched', () => {
		const other = todo({ key: 'todo_2', delegation: null });
		const result = applyDelegationActions(
			[todo(), other],
			[completedBy(bob, 1, { taskKey: 'todo_9' })],
			T0 + 60_000
		);
		expect(result[0].completed).toBe(false);
		expect(result[1]).toBe(other);
	});

	it('does not mutate its inputs', () => {
		const input = todo();
		applyDelegationActions([input], [completedBy(bob, 1)], T0 + 60_000);
		expect(input.completed).toBe(false);
	});
});
