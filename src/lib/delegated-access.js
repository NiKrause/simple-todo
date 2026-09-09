/**
 * The access controller for this chapter, and why it is registered under a
 * name that is not its own.
 *
 * `@le-space/orbitdb-access-controller-delegated-todo` wraps OrbitDB's
 * `OrbitDBAccessController`: the owner-only write set, grant/revoke and the
 * replicated permissions store all come from the base, and on top of that
 * `canAppend` admits a delegate's *delegation actions* (see delegation.js).
 *
 * It reports `type: 'todo-delegation'`, but the address it writes into the
 * list's manifest is the base controller's, `/orbitdb/<hash>` — the wrapper
 * does not touch it. OrbitDB picks the controller for a list opened BY
 * ADDRESS from that prefix. So a guest who opens a shared list by address,
 * which is how every list in this tutorial is shared, gets the plain
 * `orbitdb` controller, and a delegate's write is refused on their own
 * machine before it is ever signed.
 *
 * de2do sidesteps this by having every peer open lists by NAME with the
 * controller passed explicitly, which works when the name is derivable
 * (`<ownerDid>_projects`) and fails the moment it is not.
 *
 * This chapter takes the other route: register the delegation controller as
 * the `orbitdb` type. Every `/orbitdb/…` controller this app opens — created
 * here or reached by address — then checks the delegation rules, and the
 * manifest stays one that other builds and the relay can still open. What
 * the relay does with a delegate's entries is a separate matter, covered in
 * the README.
 */
import { useAccessController } from '@orbitdb/core';
import DelegatedTodoAccessController from '@le-space/orbitdb-access-controller-delegated-todo';

/** What `db.access.type` reads on a list that accepts delegation actions. */
export const DELEGATION_ACCESS_TYPE = 'todo-delegation';

/**
 * @param {{ write?: string[] }} [options]
 */
export const DelegatedListAccessController = ({ write } = {}) =>
	DelegatedTodoAccessController({ write, verbose: import.meta.env?.DEV === true });

// Registered under the base type on purpose — see the module comment.
DelegatedListAccessController.type = 'orbitdb';

let registered = false;

/** Idempotent; call before the first `orbitdb.open`. */
export function registerDelegatedAccessController() {
	if (registered) return;
	useAccessController(DelegatedListAccessController);
	registered = true;
}

/**
 * @param {any} db an open OrbitDB database (or nothing yet)
 */
export function supportsDelegation(db) {
	return db?.access?.type === DELEGATION_ACCESS_TYPE;
}
