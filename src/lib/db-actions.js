import { writable, derived, get } from 'svelte/store';
import { peerIdStore } from './p2p-stores.js';
import { DelegatedListAccessController, supportsDelegation } from './delegated-access.js';
import {
	applyDelegationActions,
	buildDelegationAction,
	buildDelegationActionKey,
	isDelegationActionKey,
	isDelegationActiveFor
} from './delegation.js';
import { confirmDelegatedWrite } from './delegated-write-auth.js';
import { rememberList, listRegistryStore, openListRegistry } from './list-registry.js';
import { relayHttpStatusStore } from './relay-status.js';

/**
 * @typedef {{
 *   text: string
 *   completed: boolean
 *   createdBy: string
 *   createdByIdentity?: string | null
 *   delegation?: import('./delegation.js').Delegation | null
 *   updatedBy?: string
 *   assignee: string | null
 *   createdAt: string
 *   updatedAt: string
 * }} TodoValue
 */

/**
 * @typedef {TodoValue & {
 *   id: string
 *   key: string
 * }} TodoItem
 */

/**
 * @typedef {{
 *   hash: string
 *   key: string
 *   value: TodoValue
 * }} TodoRecord
 */

/**
 * @typedef {{
 *   address: unknown
 *   all: () => Promise<TodoRecord[]>
 *   iterator?: (options?: { amount?: number }) => AsyncIterable<TodoRecord>
 *   get: (key: string) => Promise<TodoRecord | TodoValue | null | undefined>
 *   put: (key: string, value: TodoValue) => Promise<unknown>
 *   del: (key: string) => Promise<unknown>
 *   drop: () => Promise<unknown>
 *   log?: {
 *     values?: () => Promise<any[]>
 *     heads?: () => Promise<any[]>
 *     joinEntry?: (entry: any) => Promise<unknown>
 *   }
 *   peers?: Set<string>
 *   sync?: {
 *     add?: (entry: any) => Promise<unknown>
 *     start?: () => Promise<unknown>
 *     stop?: () => Promise<unknown>
 *   }
 *   events: {
 *     on: (event: string, handler: (...args: any[]) => void | Promise<void>) => void
 *   }
 * }} TodoDatabase
 */

/**
 * @param {TodoValue | TodoRecord} record
 * @returns {TodoValue}
 */
function unwrapTodoValue(record) {
	return 'value' in record ? record.value : record;
}

// Store for OrbitDB instances
export const orbitdbStore = writable(/** @type {any} */ (null));
export const todoDBStore = writable(/** @type {TodoDatabase | null} */ (null));
export const todoDBAddressStore = writable('');

/**
 * The OrbitDB identity id this session writes with: the passkey DID, or the
 * anonymous identity's public key. Ownership of a todo (delegation01) is
 * decided against this, not against the peer id, which changes on reload.
 */
export const ownIdentityIdStore = derived(
	orbitdbStore,
	($orbitdb) => $orbitdb?.identity?.id ?? null
);

/**
 * Which list is currently open, and how the user got to it. Before this the UI
 * only knew the address, so a freshly created private list was indistinguishable
 * from the shared one and the header kept advertising the shared mnemonic
 * (issue #114).
 *
 * kind: 'shared'  — the public mnemonic list every visitor lands in
 *       'private' — created here, owner-only writes
 *       'guest'   — opened by address, someone else's list
 *
 * @typedef {{ kind: 'shared' | 'private' | 'guest', name: string, address: string }} ActiveList
 */
export const activeListStore = writable(
	/** @type {ActiveList} */ ({ kind: 'shared', name: '', address: '' })
);

// Store for todos
export const todosStore = writable(/** @type {TodoItem[]} */ ([]));
/** @typedef {'unknown' | 'pending' | 'pinned' | 'unavailable'} TodoReplicationStatus */
export const todoReplicationStatusStore = writable(
	/** @type {Record<string, TodoReplicationStatus>} */ ({})
);

// Derived store that updates when todos change
export const todosCountStore = derived(todosStore, ($todos) => $todos.length);

const observedDatabases = new WeakSet();
const relayProofsInFlight = new Set();
/** @type {Promise<void> | null} */
let pendingTodosLoad = null;
let todosReloadRequested = false;
/** @type {any[]} */
let todoEntriesReceivedDuringLoad = [];
// This is a collaborative demo database with an append-only history. Reading an
// unlimited history can monopolize IndexedDB/IPFS long enough to delay live sync.
const INITIAL_TODO_LIMIT = 250;
const RELAY_PROOF_ATTEMPTS = 3;
/**
 * @param {TodoDatabase | null | undefined} todoDB
 * @returns {string}
 */
function getDatabaseAddress(todoDB) {
	if (!todoDB) return '';

	const address = todoDB.address;
	if (typeof address === 'string') return address;

	if (address && typeof address.toString === 'function') {
		return address.toString();
	}

	return '';
}

/**
 * @param {TodoDatabase | null} todoDB
 * @param {{ kind: 'shared' | 'private' | 'guest', name?: string }} [meta]
 */
function setActiveTodoDatabase(todoDB, meta) {
	const address = getDatabaseAddress(todoDB);
	todoDBStore.set(todoDB);
	todoDBAddressStore.set(address);
	if (meta) activeListStore.set({ kind: meta.kind, name: meta.name ?? '', address });
}

// Initialize database and load existing todos
/**
 * @param {any} orbitdb
 * @param {TodoDatabase} todoDB
 */
export async function initializeDatabase(orbitdb, todoDB) {
	orbitdbStore.set(orbitdb);
	setActiveTodoDatabase(todoDB, { kind: 'shared', name: todoDB?.name ?? '' });

	// OrbitDB's non-indexed keyvalue.all() traverses the complete append-only
	// history. Hydrate the UI in the background instead of blocking app startup.
	setupDatabaseListeners(todoDB);
	void loadTodos();

	// Open the registry at startup, not just when something is written to it.
	// Opening it lazily meant a reload showed no lists at all: nothing writes on
	// a fresh load, so the registry was never opened and the switcher stayed
	// hidden even though the entries were there.
	void openListRegistry(orbitdb).catch((error) => {
		console.warn('List registry unavailable:', error);
	});
}

/**
 * Open an OrbitDB todo database by address and make it the active todo list.
 *
 * @param {string} address
 * @returns {Promise<{ address: string, count: number }>}
 */
export async function loadTodoDatabase(address) {
	const orbitdb = get(orbitdbStore);
	const normalizedAddress = address.trim();

	if (!orbitdb) {
		throw new Error('OrbitDB is not initialized yet.');
	}

	if (!normalizedAddress) {
		throw new Error('Enter an OrbitDB database address.');
	}

	if (!normalizedAddress.startsWith('/orbitdb/')) {
		throw new Error('The database address must start with "/orbitdb/".');
	}

	try {
		const loadedTodoDB = await orbitdb.open(normalizedAddress, {
			type: 'keyvalue',
			sync: true
		});

		// Prefer what the registry already knows: a list you created is yours even
		// when you reach it through the switcher, and its friendly name is not the
		// suffixed database name.
		const openedAddressForMeta = getDatabaseAddress(loadedTodoDB) || normalizedAddress;
		const known = get(listRegistryStore).find((entry) => entry.address === openedAddressForMeta);
		setActiveTodoDatabase(loadedTodoDB, {
			kind: known?.role === 'owner' ? 'private' : 'guest',
			name: known?.name || loadedTodoDB?.name || ''
		});
		setupDatabaseListeners(loadedTodoDB);
		await loadTodos();

		const openedAddress = getDatabaseAddress(loadedTodoDB) || normalizedAddress;
		try {
			await rememberList(orbitdb, {
				address: openedAddress,
				name: loadedTodoDB?.name ?? '',
				role: 'guest'
			});
		} catch (error) {
			console.warn('Could not record the opened list in the registry:', error);
		}

		return {
			address: openedAddress,
			count: get(todosCountStore)
		};
	} catch (error) {
		throw new Error(
			`Failed to load Todo DB: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

/**
 * Create a NEW private todo list: an access-controlled database whose
 * initial write set is only the creator's own identity. Grants/revokes then
 * happen at runtime through the permissions panel without changing the
 * address (acl01). The new list becomes the active list.
 *
 * delegation01: the controller is the delegated-todo one, which is the
 * acl01 controller plus one extra rule — a DID a single todo was delegated
 * to may complete or rename that todo without being in the write set.
 *
 * @param {string} [name] optional human name; a unique suffix is always added
 * @returns {Promise<{ address: string, name: string }>}
 */
export async function createPrivateTodoList(name = 'private-todos') {
	const orbitdb = get(orbitdbStore);
	if (!orbitdb) throw new Error('OrbitDB is not initialized yet.');

	const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	const dbName = `${name.trim() || 'private-todos'}-${suffix}`;
	const privateDB = await orbitdb.open(dbName, {
		type: 'keyvalue',
		create: true,
		sync: true,
		AccessController: DelegatedListAccessController({ write: [orbitdb.identity.id] })
	});

	const listName = name.trim() || 'private-todos';
	setActiveTodoDatabase(privateDB, { kind: 'private', name: listName });
	setupDatabaseListeners(privateDB);
	await loadTodos();
	const address = getDatabaseAddress(privateDB) || '';
	// Record it, so the list survives a reload and shows up in the switcher.
	// Best effort: a failing registry must not lose the list the user just made.
	try {
		await rememberList(orbitdb, { address, name: listName, role: 'owner' });
	} catch (error) {
		console.warn('Could not record the new list in the registry:', error);
	}
	// The caller needs both: the address is what gets shared, the name is what
	// the user recognises it by. Returning only the address is what left the
	// created list invisible (issue #114).
	return { address, name: listName };
}

// Load all todos from the database
export async function loadTodos() {
	todosReloadRequested = true;
	if (pendingTodosLoad) return pendingTodosLoad;

	pendingTodosLoad = (async () => {
		do {
			todosReloadRequested = false;
			await loadTodosSnapshot();
		} while (todosReloadRequested);
		await annotateTodoAuthors();
	})().finally(() => {
		pendingTodosLoad = null;
	});

	return pendingTodosLoad;
}

async function loadTodosSnapshot() {
	const todoDB = get(todoDBStore);
	if (!todoDB) return;

	try {
		const startedAt = performance.now();
		const allTodos = await readRecentTodos(todoDB);
		if (get(todoDBStore) !== todoDB) return;

		/** @type {TodoItem[]} */
		const todosArray = [];
		/** @type {any[]} */
		const delegationActions = [];
		for (const record of /** @type {TodoRecord[]} */ (allTodos)) {
			if (isDelegationActionKey(record.key)) {
				delegationActions.push(record.value);
				continue;
			}
			todosArray.push({ id: record.hash, key: record.key, ...record.value });
		}

		// Delegates never touch a todo's own entry; their completions and
		// renames sit beside it as actions and are folded in here (delegation01).
		todosStore.set(sortTodos(applyDelegationActions(todosArray, delegationActions)));
		const pendingEntries = todoEntriesReceivedDuringLoad;
		todoEntriesReceivedDuringLoad = [];
		for (const entry of pendingEntries) applyTodoEntry(entry, false);
		console.log(
			`📋 Loaded ${todosArray.length} todos from the OrbitDB history in ${Math.round(performance.now() - startedAt)}ms`
		);
	} catch (error) {
		console.error('❌ Error loading todos:', error);
	}
}

/**
 * Read a bounded current view when OrbitDB exposes its iterator. This keeps
 * startup and live replication responsive even after years of shared history.
 * Test doubles and older compatible stores can still fall back to `all()`.
 *
 * @param {TodoDatabase} todoDB
 * @returns {Promise<TodoRecord[]>}
 */
async function readRecentTodos(todoDB) {
	if (!todoDB.iterator) return todoDB.all();

	const todos = [];
	for await (const todo of todoDB.iterator({ amount: INITIAL_TODO_LIMIT })) {
		todos.push(todo);
	}
	return todos;
}

/** @param {TodoItem[]} todos */
function sortTodos(todos) {
	return todos.sort((a, b) => {
		const dateA = new Date(a.createdAt || 0).getTime();
		const dateB = new Date(b.createdAt || 0).getTime();
		return dateB - dateA;
	});
}

// Resolve an entry's identity hash to the author's identity id (the DID for
// passkey identities). entry.identity is set by OrbitDB itself, so unlike a
// value field it cannot be spoofed by whoever writes the todo payload.
/** @type {Map<string, string>} */
const authorByIdentityHash = new Map();

/** @param {string | undefined} identityHash */
async function resolveAuthor(identityHash) {
	if (!identityHash) return '';
	const cached = authorByIdentityHash.get(identityHash);
	if (cached !== undefined) return cached;
	try {
		const orbitdb = get(orbitdbStore);
		const identity = await orbitdb?.identities?.getIdentity?.(identityHash);
		const author = identity?.id ?? '';
		authorByIdentityHash.set(identityHash, author);
		return author;
	} catch {
		return '';
	}
}

/** @param {string} key @param {string} author */
function patchTodoAuthor(key, author) {
	if (!author) return;
	todosStore.update((todos) =>
		todos.map((todo) => (todo.key === key && !todo.author ? { ...todo, author } : todo))
	);
}

/**
 * Backfill authors for todos loaded through the iterator (which yields only
 * hash/key/value): fetch the full log entry to reach entry.identity.
 */
async function annotateTodoAuthors() {
	const todoDB = get(todoDBStore);
	if (!todoDB?.log?.get) return;
	const todos = get(todosStore);
	for (const todo of todos) {
		if (todo.author || !todo.id) continue;
		try {
			const entry = await todoDB.log.get(todo.id);
			patchTodoAuthor(todo.key, await resolveAuthor(entry?.identity));
		} catch {
			// entry not locally available yet — a later update event will carry it
		}
	}
}

/**
 * @param {any} entry
 * @param {boolean} [trackDuringLoad=true]
 */
function applyTodoEntry(entry, trackDuringLoad = true) {
	const { op, key, value } = entry?.payload ?? {};
	if (!key || (op !== 'PUT' && op !== 'DEL')) return false;
	// A delegation action changes a *different* key's todo. Rather than merge
	// one action incrementally, let the caller re-read the log, where all of
	// them are folded in together and in order.
	if (isDelegationActionKey(key)) return false;
	if (trackDuringLoad && pendingTodosLoad) todoEntriesReceivedDuringLoad.push(entry);

	todosStore.update((todos) => {
		const withoutPreviousValue = todos.filter((todo) => todo.key !== key);
		if (op === 'DEL') return withoutPreviousValue;

		return sortTodos([...withoutPreviousValue, { id: entry.hash, key, ...value }]);
	});
	void resolveAuthor(entry?.identity).then((author) => patchTodoAuthor(key, author));
	// The raw entry just replaced a todo that may have had delegate actions
	// folded in; a re-read puts the surviving ones back (or drops them, if
	// this write revoked the delegation).
	if (value?.delegation) void loadTodos();
	return true;
}

// Set up database event listeners
/**
 * @param {TodoDatabase} todoDB
 */
function setupDatabaseListeners(todoDB) {
	if (!todoDB) return;
	if (observedDatabases.has(todoDB)) return;
	observedDatabases.add(todoDB);

	// Listen for new entries being added
	todoDB.events.on('join', (_peerId, heads) => {
		console.log('📝 Database peer joined:', heads);
		void loadTodos();
	});

	// Listen for entries being updated
	todoDB.events.on('update', (...args) => {
		const entry = args.find((value) => value?.payload);
		console.log('🔄 Entry updated:', entry);
		if (!applyTodoEntry(entry)) {
			void loadTodos();
			return;
		}

		const { op, key } = entry?.payload ?? {};
		if (op === 'PUT' && key && entry?.hash) {
			scheduleRelayReplicationProof(key, String(entry.hash), getDatabaseAddress(todoDB));
		}
	});
}

/**
 * @typedef {{ delegateDid?: string | null, expiresAt?: string | null }} DelegationRequest
 */

/**
 * @param {DelegationRequest | null | undefined} request
 * @param {string | null} grantedBy
 * @param {import('./delegation.js').Delegation | null} [previous] kept `grantedAt` when re-delegating to the same DID
 * @returns {import('./delegation.js').Delegation | null}
 */
function buildDelegation(request, grantedBy, previous = null) {
	const delegateDid = request?.delegateDid?.trim();
	if (!delegateDid) return null;
	return {
		delegateDid,
		grantedBy,
		grantedAt:
			previous?.delegateDid === delegateDid && previous?.grantedAt
				? previous.grantedAt
				: new Date().toISOString(),
		expiresAt: request?.expiresAt || null,
		revokedAt: null
	};
}

/** @param {unknown} error */
function describeWriteError(error) {
	const message = error instanceof Error ? error.message : String(error);
	const denied = /not allowed to write|does not have write access|access denied/i.test(message);
	return { denied, message };
}

// Add a new todo
/**
 * @param {string} text
 * @param {string | null} [assignee=null]
 * @param {DelegationRequest | null} [delegation=null] delegation01: hand this todo to a DID on creation
 */
export async function addTodo(text, assignee = null, delegation = null) {
	const todoDB = get(todoDBStore);
	const myPeerId = get(peerIdStore);
	const myIdentityId = get(ownIdentityIdStore);

	if (!todoDB || !myPeerId) {
		console.error('❌ Database or peer ID not available');
		return { ok: false, error: 'Database is not ready yet.' };
	}

	if (!text || text.trim() === '') {
		console.error('❌ Todo text cannot be empty');
		return { ok: false, error: 'Todo text cannot be empty.' };
	}

	if (delegation?.delegateDid?.trim() && !supportsDelegation(todoDB)) {
		return {
			ok: false,
			error: 'This list does not support delegation. Create a private list to delegate todos.'
		};
	}

	try {
		const todoId = `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		/** @type {TodoValue} */
		const todo = {
			text: text.trim(),
			completed: false,
			createdBy: myPeerId,
			// Ownership for delegation is by identity, which survives a reload;
			// the peer id above does not.
			createdByIdentity: myIdentityId,
			delegation: buildDelegation(delegation, myIdentityId),
			assignee: assignee,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		const entryHash = String(await todoDB.put(todoId, todo));
		scheduleRelayReplicationProof(todoId, entryHash, getDatabaseAddress(todoDB));
		console.log('✅ Todo added:', todoId);
		return { ok: true };
	} catch (error) {
		// A denied write throws inside OrbitDB's canAppend gate BEFORE anything
		// is appended locally, so nothing shows up as "saved" — surface why.
		console.error('❌ Error adding todo:', error);
		const { denied, message } = describeWriteError(error);
		return {
			ok: false,
			error: denied
				? 'Your identity has no write permission for this list. Ask the owner to add your DID.'
				: `Failed to add todo: ${message}`
		};
	}
}

/** @param {string} todoKey @param {string} entryHash @param {string} dbAddress */
function scheduleRelayReplicationProof(todoKey, entryHash, dbAddress) {
	if (relayProofsInFlight.has(todoKey)) return;
	if (get(todoReplicationStatusStore)[todoKey] === 'pinned') return;

	relayProofsInFlight.add(todoKey);
	todoReplicationStatusStore.update((statuses) => ({ ...statuses, [todoKey]: 'pending' }));
	void verifyRelayReplication(todoKey, entryHash, dbAddress).finally(() => {
		relayProofsInFlight.delete(todoKey);
	});
}

/**
 * Ask the connected relay to perform a fresh database sync. A green state is only
 * assigned when the relay reports this exact OrbitDB entry as its last local record.
 * @param {string} todoKey
 * @param {string} entryHash
 * @param {string} dbAddress
 */
async function verifyRelayReplication(todoKey, entryHash, dbAddress) {
	const { origin } = get(relayHttpStatusStore);
	if (!origin || !entryHash || !dbAddress) {
		console.warn('Relay replication proof skipped:', {
			todoKey,
			reason: !origin
				? 'no connected relay HTTP origin'
				: !entryHash
					? 'missing OrbitDB entry hash'
					: 'missing OrbitDB database address'
		});
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
		return;
	}

	try {
		for (let attempt = 1; attempt <= RELAY_PROOF_ATTEMPTS; attempt++) {
			const proof = await requestRelayReplicationProof(origin, dbAddress, todoKey, attempt);
			const replicated = proof?.ok === true && proof?.lastRecord?.hash === entryHash;
			if (replicated) {
				console.info('Relay replication proof verified:', { todoKey, entryHash, attempt });
				todoReplicationStatusStore.update((statuses) => ({
					...statuses,
					[todoKey]: 'pinned'
				}));
				return;
			}

			console.warn('Relay replication proof did not include the expected entry:', {
				todoKey,
				attempt,
				expectedEntryHash: entryHash,
				reportedEntryHash: proof?.lastRecord?.hash ?? null,
				relayOk: proof?.ok ?? null,
				entryCount: proof?.entryCount ?? null,
				snapshotSource: proof?.snapshotSource ?? null
			});
		}
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
	} catch (error) {
		console.warn('Relay pinning proof unavailable for todo:', todoKey, error);
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[todoKey]: 'unavailable'
		}));
	}
}

/** @param {string} origin @param {string} dbAddress @param {string} todoKey @param {number} attempt */
async function requestRelayReplicationProof(origin, dbAddress, todoKey, attempt) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 30_000);
	try {
		console.info('Requesting relay replication proof:', {
			todoKey,
			attempt,
			dbAddress,
			endpoint: `${origin}/pinning/sync`
		});
		const responsePromise = fetch(`${origin}/pinning/sync`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ dbAddress }),
			signal: controller.signal
		});

		// The relay may already be subscribed for discovery before OrbitDB installs
		// its heads handler. Re-subscribing here makes OrbitDB perform its native
		// heads exchange while the relay database is open.
		await new Promise((resolve) => setTimeout(resolve, 250));
		const todoDB = get(todoDBStore);
		if (getDatabaseAddress(todoDB) === dbAddress && todoDB?.sync?.stop && todoDB.sync.start) {
			await todoDB.sync.stop();
			await todoDB.sync.start();
		}

		const response = await responsePromise;
		const responseText = await response.text();
		if (!response.ok) {
			throw new Error(
				`HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 500)}` : ''}`
			);
		}
		try {
			return JSON.parse(responseText);
		} catch {
			throw new Error(`Relay returned invalid JSON: ${responseText.slice(0, 500)}`);
		}
	} finally {
		clearTimeout(timeout);
	}
}

// Delete a todo
/**
 * @param {string | number} todoId
 */
export async function deleteTodo(todoId) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		// If todoId is numeric (array index), we need to find the correct database key
		let actualTodoId = todoId;
		if (typeof todoId === 'number' || !isNaN(parseInt(String(todoId), 10))) {
			const todo = get(todosStore)[parseInt(String(todoId), 10)];
			if (todo?.key) {
				actualTodoId = todo.key;
			}
		}

		// Delete the todo using the correct key
		await todoDB.del(String(actualTodoId));
		todoReplicationStatusStore.update((statuses) => {
			const next = { ...statuses };
			delete next[String(actualTodoId)];
			return next;
		});
		console.log('🗑️ Todo deleted:', todoId, 'actual key:', actualTodoId);

		return true;
	} catch (error) {
		console.error('❌ Error deleting todo:', error);
		return false;
	}
}

/**
 * Who the caller is to a given todo (delegation01).
 *
 * A todo written before this chapter has no `createdByIdentity`; it keeps the
 * acl01 behaviour, where anyone with write access may change it.
 *
 * @param {TodoValue} todoData
 * @param {string | null} identityId
 * @returns {'owner' | 'delegate' | 'none'}
 */
function roleFor(todoData, identityId) {
	const owner = todoData.createdByIdentity || null;
	if (!owner || owner === identityId) return 'owner';
	if (isDelegationActiveFor(todoData, identityId)) return 'delegate';
	return 'none';
}

/**
 * @param {string} todoKey
 * @returns {Promise<{ todoDB: TodoDatabase, todoData: TodoValue } | { error: string }>}
 */
async function readTodoForWrite(todoKey) {
	const todoDB = get(todoDBStore);
	if (!todoDB) return { error: 'Database is not ready yet.' };
	const existing = await todoDB.get(todoKey);
	if (!existing) return { error: 'Todo not found.' };
	return { todoDB, todoData: unwrapTodoValue(existing) };
}

/**
 * Write a delegate's change as a delegation action beside the todo. The
 * todo's own entry is never touched by a delegate — the access controller
 * would refuse it — and the passkey is asked to confirm first.
 *
 * @param {TodoDatabase} todoDB
 * @param {string} todoKey
 * @param {TodoValue} todoData
 * @param {string} delegateDid
 * @param {{ setCompleted: boolean } | { patch: { text?: string } }} change
 */
async function writeDelegationAction(todoDB, todoKey, todoData, delegateDid, change) {
	const actionName = 'setCompleted' in change ? 'set-completed' : 'patch-fields';
	if (!(await confirmDelegatedWrite(actionName))) {
		return { ok: false, error: 'Passkey confirmation was cancelled; nothing was written.' };
	}
	const key = buildDelegationActionKey(todoKey, delegateDid);
	const action = buildDelegationAction(
		{ taskKey: todoKey, delegateDid, expiresAt: todoData.delegation?.expiresAt ?? null },
		change
	);
	const entryHash = String(await todoDB.put(key, /** @type {any} */ (action)));
	scheduleRelayReplicationProof(key, entryHash, getDatabaseAddress(todoDB));
	await loadTodos();
	console.log(`✅ Delegated ${actionName} written:`, key);
	return { ok: true };
}

const NOT_ALLOWED = 'Only the owner of this todo, or the DID it was delegated to, can change it.';

// Toggle todo completion status
/**
 * @param {string} todoKey
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function toggleTodoComplete(todoKey) {
	try {
		const read = await readTodoForWrite(String(todoKey));
		if ('error' in read) return { ok: false, error: read.error };
		const { todoDB, todoData } = read;
		const myIdentityId = get(ownIdentityIdStore);
		const role = roleFor(todoData, myIdentityId);
		if (role === 'none') return { ok: false, error: NOT_ALLOWED };

		const nextCompleted = !(todoData.completed || false);
		if (role === 'delegate' && myIdentityId) {
			return writeDelegationAction(todoDB, String(todoKey), todoData, myIdentityId, {
				setCompleted: nextCompleted
			});
		}

		const updatedTodo = {
			...todoData,
			completed: nextCompleted,
			updatedAt: new Date().toISOString()
		};
		const entryHash = String(await todoDB.put(String(todoKey), updatedTodo));
		todoReplicationStatusStore.update((statuses) => ({
			...statuses,
			[String(todoKey)]: 'pending'
		}));
		void verifyRelayReplication(String(todoKey), entryHash, getDatabaseAddress(todoDB));
		console.log('✅ Todo toggled:', todoKey, updatedTodo.completed);
		return { ok: true };
	} catch (error) {
		console.error('❌ Error toggling todo:', error);
		const { denied, message } = describeWriteError(error);
		return { ok: false, error: denied ? NOT_ALLOWED : `Failed to update todo: ${message}` };
	}
}

/**
 * Rename a todo. Owners rewrite the todo; a delegate writes a `patch-fields`
 * action, the second of the two things the access controller lets them do.
 *
 * @param {string} todoKey
 * @param {string} text
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function updateTodoText(todoKey, text) {
	const nextText = text.trim();
	if (!nextText) return { ok: false, error: 'Todo text cannot be empty.' };
	try {
		const read = await readTodoForWrite(todoKey);
		if ('error' in read) return { ok: false, error: read.error };
		const { todoDB, todoData } = read;
		const myIdentityId = get(ownIdentityIdStore);
		const role = roleFor(todoData, myIdentityId);
		if (role === 'none') return { ok: false, error: NOT_ALLOWED };

		if (role === 'delegate' && myIdentityId) {
			return writeDelegationAction(todoDB, todoKey, todoData, myIdentityId, {
				patch: { text: nextText }
			});
		}

		const updatedTodo = { ...todoData, text: nextText, updatedAt: new Date().toISOString() };
		const entryHash = String(await todoDB.put(todoKey, updatedTodo));
		scheduleRelayReplicationProof(todoKey, entryHash, getDatabaseAddress(todoDB));
		return { ok: true };
	} catch (error) {
		console.error('❌ Error renaming todo:', error);
		const { denied, message } = describeWriteError(error);
		return { ok: false, error: denied ? NOT_ALLOWED : `Failed to rename todo: ${message}` };
	}
}

/**
 * Hand a todo to another DID, or re-delegate it (delegation01). Owner only:
 * the delegation lives inside the todo's own entry, which only the write set
 * may rewrite.
 *
 * @param {string} todoKey
 * @param {DelegationRequest} request
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function delegateTodo(todoKey, request) {
	if (!request?.delegateDid?.trim()) return { ok: false, error: 'Enter the DID to delegate to.' };
	try {
		const read = await readTodoForWrite(todoKey);
		if ('error' in read) return { ok: false, error: read.error };
		const { todoDB, todoData } = read;
		if (!supportsDelegation(todoDB)) {
			return { ok: false, error: 'This list does not support delegation.' };
		}
		const myIdentityId = get(ownIdentityIdStore);
		if (roleFor(todoData, myIdentityId) !== 'owner') {
			return { ok: false, error: 'Only the owner of a todo can delegate it.' };
		}
		if (request.delegateDid.trim() === myIdentityId) {
			return { ok: false, error: 'You already own this todo; delegate it to someone else.' };
		}
		const updatedTodo = {
			...todoData,
			delegation: buildDelegation(request, myIdentityId, todoData.delegation ?? null),
			updatedAt: new Date().toISOString()
		};
		const entryHash = String(await todoDB.put(todoKey, updatedTodo));
		scheduleRelayReplicationProof(todoKey, entryHash, getDatabaseAddress(todoDB));
		await loadTodos();
		return { ok: true };
	} catch (error) {
		console.error('❌ Error delegating todo:', error);
		const { message } = describeWriteError(error);
		return { ok: false, error: `Failed to delegate todo: ${message}` };
	}
}

/**
 * Take a delegation back. The delegate's earlier actions stop applying the
 * moment this entry replicates — see applyDelegationActions — and any they
 * write afterwards are ignored on read.
 *
 * @param {string} todoKey
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function revokeTodoDelegation(todoKey) {
	try {
		const read = await readTodoForWrite(todoKey);
		if ('error' in read) return { ok: false, error: read.error };
		const { todoDB, todoData } = read;
		if (!todoData.delegation?.delegateDid) {
			return { ok: false, error: 'This todo is not delegated.' };
		}
		const myIdentityId = get(ownIdentityIdStore);
		if (roleFor(todoData, myIdentityId) !== 'owner') {
			return { ok: false, error: 'Only the owner of a todo can revoke its delegation.' };
		}
		const now = new Date().toISOString();
		const updatedTodo = {
			...todoData,
			delegation: { ...todoData.delegation, revokedAt: now, revokedBy: myIdentityId },
			updatedAt: now
		};
		const entryHash = String(await todoDB.put(todoKey, updatedTodo));
		scheduleRelayReplicationProof(todoKey, entryHash, getDatabaseAddress(todoDB));
		await loadTodos();
		return { ok: true };
	} catch (error) {
		console.error('❌ Error revoking delegation:', error);
		const { message } = describeWriteError(error);
		return { ok: false, error: `Failed to revoke delegation: ${message}` };
	}
}

// Update todo assignee
/**
 * @param {string} todoId
 * @param {string | null} assignee
 */
export async function updateTodoAssignee(todoId, assignee) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		const existingTodo = await todoDB.get(todoId);
		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId);
			return false;
		}

		// Access the nested value property for the todo data
		const todoData = unwrapTodoValue(existingTodo);

		const updatedTodo = {
			...todoData,
			assignee: assignee,
			updatedAt: new Date().toISOString()
		};

		const entryHash = String(await todoDB.put(todoId, updatedTodo));
		todoReplicationStatusStore.update((statuses) => ({ ...statuses, [todoId]: 'pending' }));
		void verifyRelayReplication(todoId, entryHash, getDatabaseAddress(todoDB));
		console.log('✅ Todo assignee updated:', todoId, assignee);
		return true;
	} catch (error) {
		console.error('❌ Error updating todo assignee:', error);
		return false;
	}
}

// Get todos by assignee
/**
 * @param {string | null} assignee
 */
export function getTodosByAssignee(assignee) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.assignee === assignee));
}

// Get todos by completion status
/**
 * @param {boolean} completed
 */
export function getTodosByStatus(completed) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.completed === completed));
}

// Get todos created by a specific peer
/**
 * @param {string} creatorId
 */
export function getTodosByCreator(creatorId) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.createdBy === creatorId));
}

// Delete the current database
export async function deleteCurrentDatabase() {
	const todoDB = get(todoDBStore);
	const orbitdb = get(orbitdbStore);

	if (!todoDB || !orbitdb) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		console.log('🗑️ Deleting current database...');

		// Close the current database
		await todoDB.drop();
		// console.log('✅ Database closed')

		// Drop the database from OrbitDB
		// await orbitdb.close('todos')
		console.log('✅ Database dropped from OrbitDB');

		// Clear the stores
		setActiveTodoDatabase(null);
		todosStore.set([]);

		console.log('✅ Database recreated successfully');
		return true;
	} catch (error) {
		console.error('❌ Error deleting database:', error);
		return false;
	}
}

// Make the function available globally for browser console access
if (typeof window !== 'undefined') {
	const browserWindow = /** @type {Window & typeof globalThis & {
	 *   deleteCurrentDatabase?: typeof deleteCurrentDatabase,
	 *   forceReloadTodos?: typeof loadTodos,
	 *   loadTodoDatabase?: typeof loadTodoDatabase,
	 *   getTodoDatabaseAddress?: () => string,
	 *   getTodoDatabasePeerCount?: () => number,
	 *   getTodoCount?: () => number
	 * }} */ (window);

	browserWindow.deleteCurrentDatabase = deleteCurrentDatabase;
	browserWindow.forceReloadTodos = loadTodos;
	browserWindow.loadTodoDatabase = loadTodoDatabase;
	browserWindow.getTodoDatabaseAddress = () => getDatabaseAddress(get(todoDBStore));
	browserWindow.getTodoDatabasePeerCount = () => get(todoDBStore)?.peers?.size ?? 0;
	browserWindow.getTodoCount = () => get(todosCountStore);
	console.log('🔧 deleteCurrentDatabase function is now available in browser console');
}
