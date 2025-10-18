import { browser } from '$app/environment';
import { getHybridManager } from './hybrid-mode.js';
import { addTodo, toggleTodoComplete, deleteTodo } from './db-actions.js';
import { clientLogger } from './console-logger.js';

class FormInterceptor {
	constructor() {
		this.isActive = false;
		
		if (browser) {
			this.setupInterceptor();
		}
	}

	setupInterceptor() {
		// Override form submissions when in client mode
		document.addEventListener('submit', this.handleFormSubmit.bind(this));
		clientLogger.info('Form interceptor initialized for hybrid mode');
	}

	async handleFormSubmit(event) {
		const hybridManager = getHybridManager();
		
		// Check if we should intercept (client mode OR offline/server unreachable)
		const shouldIntercept = !hybridManager || 
			!hybridManager.isServerMode() || 
			!navigator.onLine; // Also intercept when offline
		
		if (!shouldIntercept) {
			// Try server submission, but have a fallback
			const form = event.target;
			
			// Set a timeout to detect server issues
			const timeoutPromise = new Promise((resolve) => {
				setTimeout(() => resolve('timeout'), 3000); // 3 second timeout
			});
			
			// If form submission fails or times out, intercept it
			form.addEventListener('submit', () => {
				Promise.race([
					fetch(form.action, { method: 'HEAD', cache: 'no-cache' }),
					timeoutPromise
				]).then(result => {
					if (result === 'timeout' || !result.ok) {
						clientLogger.warning('Server submission failed, switching to client mode');
						if (hybridManager) {
							hybridManager.triggerClientFallback();
						}
					}
				}).catch(() => {
					clientLogger.warning('Network error, switching to client mode');
					if (hybridManager) {
						hybridManager.triggerClientFallback();
					}
				});
			}, { once: true });
			
			return; // Let form submission proceed normally
		}

		// We're in client mode or offline, intercept the form submission
		event.preventDefault();
		clientLogger.info('Form submission intercepted - routing to client-side OrbitDB');

		const form = event.target;
		const formData = new FormData(form);
		const action = form.action;

		try {
			if (action.includes('?/addTodo')) {
				await this.handleAddTodo(formData);
			} else if (action.includes('?/toggleTodo')) {
				await this.handleToggleTodo(formData);
			} else if (action.includes('?/deleteTodo')) {
				await this.handleDeleteTodo(formData);
			} else {
				clientLogger.warning('Unknown form action:', action);
			}
		} catch (error) {
			clientLogger.error('Form interception failed:', error);
		}
	}

	async handleAddTodo(formData) {
		const text = formData.get('text');
		const assignee = formData.get('assignee');
		
		if (!text || text.trim() === '') {
			clientLogger.warning('Empty todo text, ignoring');
			return;
		}

		clientLogger.dbOp('ADD_TODO', `Intercepted: "${text}"`);
		const success = await addTodo(text.trim(), assignee);
		
		if (success) {
			// Clear the form
			const textInput = document.querySelector('input[name="text"]');
			if (textInput) {
				textInput.value = '';
			}
			clientLogger.success('Todo added via client-side OrbitDB');
		} else {
			clientLogger.error('Failed to add todo via client-side OrbitDB');
		}
	}

	async handleToggleTodo(formData) {
		const todoId = formData.get('id');
		
		if (!todoId) {
			clientLogger.warning('No todo ID provided for toggle');
			return;
		}

		clientLogger.dbOp('TOGGLE_TODO', `Intercepted: ${todoId}`);
		const success = await toggleTodoComplete(todoId);
		
		if (success) {
			clientLogger.success('Todo toggled via client-side OrbitDB');
		} else {
			clientLogger.error('Failed to toggle todo via client-side OrbitDB');
		}
	}

	async handleDeleteTodo(formData) {
		const todoId = formData.get('id');
		
		if (!todoId) {
			clientLogger.warning('No todo ID provided for delete');
			return;
		}

		clientLogger.dbOp('DELETE_TODO', `Intercepted: ${todoId}`);
		const success = await deleteTodo(todoId);
		
		if (success) {
			clientLogger.success('Todo deleted via client-side OrbitDB');
		} else {
			clientLogger.error('Failed to delete todo via client-side OrbitDB');
		}
	}

	activate() {
		this.isActive = true;
		clientLogger.info('Form interceptor activated for client mode');
	}

	deactivate() {
		this.isActive = false;
		clientLogger.info('Form interceptor deactivated for server mode');
	}
}

// Singleton instance
let formInterceptorInstance = null;

export function getFormInterceptor() {
	if (!formInterceptorInstance && browser) {
		formInterceptorInstance = new FormInterceptor();
	}
	return formInterceptorInstance;
}

export { FormInterceptor };