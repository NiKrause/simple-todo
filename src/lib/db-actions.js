import { writable, derived, get } from 'svelte/store';
import { peerIdStore } from './p2p.js';

/**
 * @typedef {{
 *   text: string
 *   completed: boolean
 *   createdBy: string
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
 *   all: () => Promise<TodoRecord[]>
 *   get: (key: string) => Promise<TodoRecord | TodoValue | null | undefined>
 *   put: (key: string, value: TodoValue) => Promise<unknown>
 *   del: (key: string) => Promise<unknown>
 *   drop: () => Promise<unknown>
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

// Store for todos
export const todosStore = writable(/** @type {TodoItem[]} */ ([]));

// Derived store that updates when todos change
export const todosCountStore = derived(todosStore, ($todos) => $todos.length);

const observedDatabases = new WeakSet();

// Initialize database and load existing todos
/**
 * @param {any} orbitdb
 * @param {TodoDatabase} todoDB
 */
export async function initializeDatabase(orbitdb, todoDB) {
	orbitdbStore.set(orbitdb);
	todoDBStore.set(todoDB);

	// Load existing todos
	await loadTodos();

	// Set up event listeners for database changes
	setupDatabaseListeners(todoDB);
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

		todoDBStore.set(loadedTodoDB);
		setupDatabaseListeners(loadedTodoDB);
		await loadTodos();

		return {
			address: normalizedAddress,
			count: get(todosCountStore)
		};
	} catch (error) {
		throw new Error(
			`Failed to load Todo DB: ${error instanceof Error ? error.message : String(error)}`
		);
	}
}

// Load all todos from the database
async function loadTodos() {
	const todoDB = get(todoDBStore);
	if (!todoDB) return;

	try {
		const allTodos = await todoDB.all();
		console.log('🔍 Raw database entries:', allTodos); // Add this debug log

		// Handle both array and object structures
		/** @type {TodoItem[]} */
		let todosArray;
		todosArray = allTodos.map((/** @type {TodoRecord} */ todo) => {
			return {
				id: todo.hash,
				key: todo.key,
				...todo.value // Access the nested value property
			};
		});

		// Sort by createdAt descending (newest first)
		const sortedTodos = todosArray.sort((/** @type {TodoItem} */ a, /** @type {TodoItem} */ b) => {
			const dateA = new Date(a.createdAt || 0).getTime();
			const dateB = new Date(b.createdAt || 0).getTime();
			return dateB - dateA;
		});

		todosStore.set(sortedTodos);
		console.log('todos', sortedTodos);
		console.log('📋 Loaded todos:', sortedTodos.length);
	} catch (error) {
		console.error('❌ Error loading todos:', error);
	}
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
	todoDB.events.on('join', async (_address, entry) => {
		console.log('📝 New entry added:', entry);
		await loadTodos();
	});

	// Listen for entries being updated
	todoDB.events.on('update', async (_address, entry) => {
		console.log('🔄 Entry updated:', entry);
		await loadTodos();
	});
}

// Add a new todo
/**
 * @param {string} text
 * @param {string | null} [assignee=null]
 */
export async function addTodo(text, assignee = null) {
	const todoDB = get(todoDBStore);
	const myPeerId = get(peerIdStore);

	if (!todoDB || !myPeerId) {
		console.error('❌ Database or peer ID not available');
		return false;
	}

	if (!text || text.trim() === '') {
		console.error('❌ Todo text cannot be empty');
		return false;
	}

	try {
		const todoId = `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
		/** @type {TodoValue} */
		const todo = {
			text: text.trim(),
			completed: false,
			createdBy: myPeerId,
			assignee: assignee,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};

		await todoDB.put(todoId, todo);
		console.log('✅ Todo added:', todoId);
		return true;
	} catch (error) {
		console.error('❌ Error adding todo:', error);
		return false;
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
		if (typeof todoId === 'number' || !isNaN(parseInt(todoId))) {
			// Get all todos to find the correct database key
			const allTodos = await todoDB.all();
			if (Array.isArray(allTodos)) {
				const todo = allTodos[parseInt(String(todoId), 10)];
				if (todo && todo.key) {
					actualTodoId = todo.key; // Use the key, not the hash
					console.log('🔍 Converted array index', todoId, 'to key:', actualTodoId);
				}
			}
		}

		// Delete the todo using the correct key
		await todoDB.del(String(actualTodoId));
		console.log('🗑️ Todo deleted:', todoId, 'actual key:', actualTodoId);

		// Force a reload to ensure the UI is updated
		await loadTodos();

		return true;
	} catch (error) {
		console.error('❌ Error deleting todo:', error);
		return false;
	}
}

// Toggle todo completion status
/**
 * @param {string | number} todoId
 */
export async function toggleTodoComplete(todoId) {
	const todoDB = get(todoDBStore);

	if (!todoDB) {
		console.error('❌ Database not available');
		return false;
	}

	try {
		console.log('🔍 Attempting to toggle todo with ID:', todoId); // Add this debug log

		// If todoId is numeric (array index), we need to find the actual database key
		let actualTodoId = todoId;
		if (typeof todoId === 'number' || !isNaN(parseInt(todoId))) {
			// Get all todos to find the correct database key
			const allTodos = await todoDB.all();
			if (Array.isArray(allTodos)) {
				const todo = allTodos[parseInt(String(todoId), 10)];
				if (todo && todo.hash) {
					actualTodoId = todo.hash;
					console.log('🔍 Converted array index', todoId, 'to hash:', actualTodoId);
				}
			}
		}

		const existingTodo = await todoDB.get(String(actualTodoId));
		console.log('🔍 Retrieved todo from database:', existingTodo); // Add this debug log

		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId, 'actual ID:', actualTodoId);
			// Let's also log all available todos to see what's in the database
			const allTodos = await todoDB.all();
			console.log('🔍 All available todos in database:', allTodos);
			return false;
		}

		// Access the nested value property for the todo data
		const todoData = unwrapTodoValue(existingTodo);
		const currentCompleted = todoData.completed || false;

		const updatedTodo = {
			...todoData,
			completed: !currentCompleted,
			updatedAt: new Date().toISOString()
		};

		await todoDB.put(String(actualTodoId), updatedTodo);
		console.log('✅ Todo toggled:', todoId, updatedTodo.completed);
		return true;
	} catch (error) {
		console.error('❌ Error toggling todo:', error);
		return false;
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

		await todoDB.put(todoId, updatedTodo);
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
		todoDBStore.set(null);
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
	/** @type {Window & typeof globalThis & { deleteCurrentDatabase?: typeof deleteCurrentDatabase }} */ (
		window
	).deleteCurrentDatabase = deleteCurrentDatabase;
	console.log('🔧 deleteCurrentDatabase function is now available in browser console');
}
