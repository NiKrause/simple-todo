<script>
	import { createEventDispatcher } from 'svelte';
	import { hybridMode } from './hybrid-mode.js';
	import { browser } from '$app/environment';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	export let placeholder = 'What needs to be done?';
	export let buttonText = 'Add TODO';
	export let disabled = false;

	let inputText = '';
	const dispatch = createEventDispatcher();
	
	// Track current mode
	let currentMode = 'server';
	
	if (browser) {
		hybridMode.subscribe(state => {
			currentMode = state.mode;
		});
	}

	function handleSubmit() {
		// Only handle in client mode, server mode uses form submission
		if (currentMode !== 'client') return;
		
		if (!inputText || inputText.trim() === '') return;

		dispatch('add', {
			text: inputText.trim()
		});

		inputText = '';
	}

	function handleKeydown(event) {
		if (event.key === 'Enter' && currentMode === 'client') {
			handleSubmit();
		}
	}
	
	// Progressive enhancement for server mode forms
	const enhanceAddTodo = ({ formData, cancel }) => {
		if (currentMode !== 'server') {
			cancel(); // Don't submit if not in server mode
			return;
		}
		
		console.log('🖥️ Enhancing add todo form submission (no page reload)');
		
		return async (enhancementArgs) => {
			console.log('🔍 Enhancement args:', Object.keys(enhancementArgs));
			const { result, formElement, update } = enhancementArgs;
			try {
				if (result.type === 'success') {
					// Clear the form using formElement
					if (formElement && formElement.reset) {
						formElement.reset();
						console.log('✅ Form cleared using formElement.reset()');
					} else {
						console.warn('⚠️ formElement not available, clearing manually');
						// Try to clear form manually
						const textInput = document.querySelector('input[name="text"]');
						if (textInput) {
							textInput.value = '';
							console.log('✅ Form cleared manually');
						}
					}
					
					console.log('🔄 Form success - refreshing todos...');
					
					// Try to use the global refresh function first
					if (typeof window !== 'undefined' && window.refreshTodosFromServer) {
						console.log('🌐 Using global refresh function');
						const refreshed = await window.refreshTodosFromServer();
						if (refreshed) {
							console.log('✅ Global refresh successful');
							return; // Success, exit early
						}
						console.warn('⚠️ Global refresh failed, trying direct API...');
					}
					
					// Try direct API call as backup
					try {
						console.log('🔄 Trying direct API refresh...');
						const response = await fetch('/api/todos');
						if (response.ok) {
							const result = await response.json();
							if (result.success && typeof window !== 'undefined' && window.todosStore) {
								// Try to update the store directly
								window.todosStore.set(result.todos);
								console.log('✅ Direct API refresh successful');
								return;
							}
						}
					} catch (apiError) {
						console.warn('⚠️ Direct API refresh failed:', apiError);
					}
					
					// Final fallback to invalidateAll
					console.log('🔄 Using invalidateAll as final fallback');
					await invalidateAll();
					console.log('✅ Todo added via enhanced form (no reload)');
				} else if (result.type === 'failure') {
					console.warn('⚠️ Form action failed, trying API fallback...');
					// Try API fallback
					const text = formData.get('text');
					if (text && text.trim()) {
						await tryApiAddTodo(text.trim(), form);
					}
				} else {
					console.error('❌ Form submission failed:', result);
					// Fallback to default behavior
					await update();
				}
			} catch (error) {
				console.error('❌ Enhancement error:', error);
				// Fallback to default behavior
				await update();
			}
		};
	};
	
	// API fallback function
	async function tryApiAddTodo(text, form) {
		try {
			const response = await fetch('/api/todos', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, createdBy: 'client-user' })
			});
			
			if (response.ok) {
				// Clear the form if available
				if (form && form.reset) {
					form.reset();
				} else {
					// Try to clear form manually
					const textInput = document.querySelector('input[name="text"]');
					if (textInput) textInput.value = '';
				}
				// Try to use the global refresh function if available
				if (typeof window !== 'undefined' && window.refreshTodosFromServer) {
					await window.refreshTodosFromServer();
				} else {
					await invalidateAll();
				}
				console.log('✅ Todo added via API fallback');
			} else {
				console.error('❌ API fallback failed:', response.status);
			}
		} catch (error) {
			console.error('❌ API fallback error:', error);
		}
	}
</script>

<div class="mb-6 rounded-lg bg-white p-6 shadow-md">
	<h2 class="mb-4 text-xl font-semibold">Add New TODO</h2>
	
	{#if currentMode === 'server'}
		<!-- Server mode: Use enhanced form submission (no page reload) -->
		<form method="POST" action="?/addTodo" class="space-y-4" use:enhance={enhanceAddTodo}>
			<input
				type="text"
				name="text"
				{placeholder}
				{disabled}
				data-testid="todo-input"
				class="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
			/>
			<div class="flex gap-2">
				<button
					type="submit"
					{disabled}
					data-testid="add-todo-button"
					class="rounded-md bg-blue-500 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
				>
					{buttonText}
				</button>
			</div>
		</form>
	{:else}
		<!-- Client mode: Use event dispatcher -->
		<div class="space-y-4">
			<input
				type="text"
				bind:value={inputText}
				{placeholder}
				{disabled}
				data-testid="todo-input"
				class="w-full rounded-md border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-100"
				on:keydown={handleKeydown}
			/>
			<div class="flex gap-2">
				<button
					on:click={handleSubmit}
					{disabled}
					data-testid="add-todo-button"
					class="rounded-md bg-blue-500 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
				>
					{buttonText}
				</button>
			</div>
		</div>
	{/if}
</div>
