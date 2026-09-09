/**
 * Per-todo delegation (delegation01 chapter): the pure rules.
 *
 * A list owner may hand ONE todo to another DID. The delegate cannot write to
 * the list — the write set is still owner-only — but the list's access
 * controller (`@le-space/orbitdb-access-controller-delegated-todo`) admits
 * one extra kind of entry: a *delegation action*, keyed
 * `delegation-action/<todoKey>/<delegateDid>/<nonce>`, signed by the
 * delegate, that may only set `completed` or patch `text`/`description`.
 *
 * The controller checks the action's shape and signer. It does NOT read the
 * todo. Whether the delegation was granted, revoked or has expired is decided
 * here, on read: an action whose todo no longer delegates to its signer is
 * ignored. That split is deliberate — see the chapter README — and it means
 * revocation is a client-side rule, not a cryptographic one.
 *
 * Nothing in this module touches OrbitDB, so it is unit-tested directly.
 */

export const DELEGATION_ACTION_PREFIX = 'delegation-action/';

/**
 * @typedef {{
 *   delegateDid: string
 *   grantedBy: string | null
 *   grantedAt: string
 *   expiresAt: string | null
 *   revokedAt: string | null
 *   revokedBy?: string | null
 * }} Delegation
 */

/**
 * @typedef {{
 *   type: 'delegation-action'
 *   action: 'set-completed' | 'patch-fields'
 *   taskKey: string
 *   delegateDid: string
 *   performedBy: string
 *   performedAt: string
 *   setCompleted?: boolean
 *   patch?: { text?: string, description?: string }
 *   expiresAt: string | null
 * }} DelegationAction
 */

/** @param {string} key */
export function isDelegationActionKey(key) {
	return typeof key === 'string' && key.startsWith(DELEGATION_ACTION_PREFIX);
}

/**
 * Is `identityId` currently allowed to act on `todo` as its delegate?
 * Not the owner check — owners never go through delegation.
 *
 * @param {{ delegation?: Delegation | null } | null | undefined} todo
 * @param {string | null | undefined} identityId
 * @param {number} [now]
 */
export function isDelegationActiveFor(todo, identityId, now = Date.now()) {
	const delegation = todo?.delegation;
	if (!delegation?.delegateDid || !identityId) return false;
	if (delegation.delegateDid !== identityId) return false;
	if (delegation.revokedAt) return false;
	if (delegation.expiresAt && Date.parse(delegation.expiresAt) < now) return false;
	return true;
}

/**
 * The state a delegation is in, for display.
 * @param {Delegation | null | undefined} delegation
 * @param {number} [now]
 * @returns {'none' | 'active' | 'revoked' | 'expired'}
 */
export function delegationStatus(delegation, now = Date.now()) {
	if (!delegation?.delegateDid) return 'none';
	if (delegation.revokedAt) return 'revoked';
	if (delegation.expiresAt && Date.parse(delegation.expiresAt) < now) return 'expired';
	return 'active';
}

/**
 * The key the access controller expects for a delegate's write. The DID is
 * URI-encoded because `did:key:…` contains characters the key grammar
 * reserves; the nonce keeps two actions from overwriting each other.
 *
 * @param {string} taskKey
 * @param {string} delegateDid
 */
export function buildDelegationActionKey(taskKey, delegateDid) {
	const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
	return `${DELEGATION_ACTION_PREFIX}${taskKey}/${encodeURIComponent(delegateDid)}/${nonce}`;
}

/**
 * Build the action envelope a delegate writes. `expiresAt` is copied from the
 * todo so the access controller can refuse an action written after the
 * delegation ran out without having to look the todo up.
 *
 * @param {{ taskKey: string, delegateDid: string, expiresAt?: string | null }} target
 * @param {{ setCompleted: boolean } | { patch: { text?: string, description?: string } }} change
 * @returns {DelegationAction}
 */
export function buildDelegationAction(target, change) {
	const base = {
		type: /** @type {const} */ ('delegation-action'),
		taskKey: target.taskKey,
		delegateDid: target.delegateDid,
		performedBy: target.delegateDid,
		performedAt: new Date().toISOString(),
		expiresAt: target.expiresAt ?? null
	};
	if ('setCompleted' in change) {
		return { ...base, action: 'set-completed', setCompleted: change.setCompleted };
	}
	return { ...base, action: 'patch-fields', patch: change.patch };
}

/**
 * A minimal shape check, mirroring what the access controller enforces, so a
 * malformed action that somehow got in (or one written by an older build)
 * cannot corrupt the merged view.
 *
 * @param {any} action
 * @returns {action is DelegationAction}
 */
export function isWellFormedDelegationAction(action) {
	if (!action || action.type !== 'delegation-action') return false;
	if (typeof action.taskKey !== 'string' || typeof action.delegateDid !== 'string') return false;
	if (Number.isNaN(Date.parse(action.performedAt || ''))) return false;
	if (action.action === 'set-completed') return typeof action.setCompleted === 'boolean';
	if (action.action === 'patch-fields') {
		const patch = action.patch;
		if (!patch || typeof patch !== 'object') return false;
		const keys = Object.keys(patch);
		if (keys.length === 0 || !keys.every((k) => k === 'text' || k === 'description')) return false;
		return keys.every((k) => typeof patch[k] === 'string');
	}
	return false;
}

/**
 * Fold delegation actions into their todos.
 *
 * Rules, in order:
 * - an action for an unknown todo is dropped;
 * - an action is dropped unless the todo currently delegates to its signer
 *   (`isDelegationActiveFor`) — this is where revoke and expiry take effect;
 * - an action older than the todo's own `updatedAt` is dropped: the owner
 *   wrote the todo after it, and the owner's canonical entry wins;
 * - the survivors apply in `performedAt` order.
 *
 * The third rule is a departure from de2do, where every surviving action was
 * re-applied on top of the canonical todo forever, so an owner could never
 * un-complete a todo a delegate had completed.
 *
 * Returns new todo objects; the inputs are not mutated.
 *
 * @template {{ key: string, completed?: boolean, text?: string, description?: string, updatedAt?: string, updatedBy?: string, delegation?: Delegation | null }} T
 * @param {T[]} todos
 * @param {any[]} actions
 * @param {number} [now]
 * @returns {T[]}
 */
export function applyDelegationActions(todos, actions, now = Date.now()) {
	/** @type {Map<string, any[]>} */
	const byTask = new Map();
	const byKey = new Map(todos.map((todo) => [todo.key, todo]));

	for (const action of actions) {
		if (!isWellFormedDelegationAction(action)) continue;
		const todo = byKey.get(action.taskKey);
		if (!todo) continue;
		if (!isDelegationActiveFor(todo, action.delegateDid, now)) continue;
		const canonicalAt = Date.parse(todo.updatedAt || '') || 0;
		if (Date.parse(action.performedAt) < canonicalAt) continue;
		const list = byTask.get(action.taskKey) ?? [];
		list.push(action);
		byTask.set(action.taskKey, list);
	}

	return todos.map((todo) => {
		const list = byTask.get(todo.key);
		if (!list?.length) return todo;
		list.sort((a, b) => Date.parse(a.performedAt) - Date.parse(b.performedAt));
		let next = { ...todo };
		for (const action of list) {
			if (action.action === 'set-completed') next.completed = action.setCompleted;
			if (action.action === 'patch-fields') {
				if (typeof action.patch.text === 'string') next.text = action.patch.text;
				if (typeof action.patch.description === 'string')
					next.description = action.patch.description;
			}
			next.updatedAt = action.performedAt;
			next.updatedBy = action.performedBy || action.delegateDid;
		}
		return next;
	});
}
