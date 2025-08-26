import { writable, derived, get } from 'svelte/store';
import { peerIdStore } from './p2p.js';

// Store for OrbitDB instances
export const orbitdbStore = writable(null);
export const todoDBStore = writable(null);

// Store for todos
export const todosStore = writable([]);

// Derived store that updates when todos change
export const todosCountStore = derived(todosStore, ($todos) => $todos.length);

// Initialize database and load existing todos
export async function initializeDatabase(orbitdb, todoDB, preferences) {
	orbitdbStore.set(orbitdb);
	todoDBStore.set(todoDB);

	// Load existing todos if no storge is enabled and no network we don't need to load anything
	if (preferences.enablePersistentStorage || preferences.enableNetworkConnection) {
		await loadTodos();
	}

	// Set up event listeners for database changes
	setupDatabaseListeners(todoDB);
}

// Load all todos from the database
export async function loadTodos() {
	console.log('🔍 Loading todos...');
	const todoDB = get(todoDBStore);
	if (!todoDB) return;

	try {
		const allTodos = await todoDB.all();
		console.log('🔍 Raw database entries:', allTodos); // Add this debug log

		// Handle both array and object structures
		let todosArray;
		todosArray = allTodos.map((todo) => {
			return {
				id: todo.hash,
				key: todo.key,
				...todo.value // Access the nested value property
			};
		});

		// Sort by createdAt descending (newest first)
		const sortedTodos = todosArray.sort((a, b) => {
			const dateA = new Date(a.createdAt || 0);
			const dateB = new Date(b.createdAt || 0);
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
function setupDatabaseListeners(todoDB) {
	if (!todoDB) return;

	// Listen for new entries being added
	todoDB.events.on('join', async (address, entry) => {
		console.log('📝 New entry added:', entry);
		await loadTodos();
	});

	// Listen for entries being updated
	todoDB.events.on('update', async (entry) => {
		console.log('🔄 Entry updated:', entry);
		await loadTodos();
	});
}

// Add a new todo
export async function addTodo(text, assignee = null) {
	console.log('🔍 Adding todo:', text);
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
		const todo = {
			text: text.trim(),
			completed: false,
			createdBy: myPeerId,
			assignee: assignee,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		};
		console.log('🔍 Todo:', todo);
		await todoDB.put(todoId, todo);
		console.log('🔍 Todo added:', todoId);
		// Add this line to manually refresh the UI:
		await loadTodos();
		console.log('✅ Todo added:', todoId);
		return true;
	} catch (error) {
		console.error('❌ Error adding todo:', error);
		return false;
	}
}

// Delete a todo
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
				const todo = allTodos[parseInt(todoId)];
				if (todo && todo.key) {
					actualTodoId = todo.key; // Use the key, not the hash
					console.log('🔍 Converted array index', todoId, 'to key:', actualTodoId);
				}
			}
		}

		// Delete the todo using the correct key
		await todoDB.del(actualTodoId);
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
				const todo = allTodos[parseInt(todoId)];
				if (todo && todo.hash) {
					actualTodoId = todo.hash;
					console.log('🔍 Converted array index', todoId, 'to hash:', actualTodoId);
				}
			}
		}

		const existingTodo = await todoDB.get(actualTodoId);
		console.log('🔍 Retrieved todo from database:', existingTodo); // Add this debug log

		if (!existingTodo) {
			console.error('❌ Todo not found:', todoId, 'actual ID:', actualTodoId);
			// Let's also log all available todos to see what's in the database
			const allTodos = await todoDB.all();
			console.log('🔍 All available todos in database:', allTodos);
			return false;
		}

		// Access the nested value property for the todo data
		const todoData = existingTodo.value || existingTodo;
		const currentCompleted = todoData.completed || false;

		const updatedTodo = {
			...todoData,
			completed: !currentCompleted,
			updatedAt: new Date().toISOString()
		};

		await todoDB.put(actualTodoId, updatedTodo);
		console.log('✅ Todo toggled:', todoId, updatedTodo.completed);
		return true;
	} catch (error) {
		console.error('❌ Error toggling todo:', error);
		return false;
	}
}

// Update todo assignee
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
		const todoData = existingTodo.value || existingTodo;

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
export function getTodosByAssignee(assignee) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.assignee === assignee));
}

// Get todos by completion status
export function getTodosByStatus(completed) {
	return derived(todosStore, ($todos) => $todos.filter((todo) => todo.completed === completed));
}

// Get todos created by a specific peer
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
	window.deleteCurrentDatabase = deleteCurrentDatabase;
	console.log('🔧 deleteCurrentDatabase function is now available in browser console');
}
