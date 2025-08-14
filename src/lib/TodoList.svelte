<script>
  import { createEventDispatcher } from 'svelte'
  import TodoItem from './TodoItem.svelte'
  
  export let todos = []
  export let title = 'TODO Items'
  export let emptyMessage = 'No TODOs yet. Add one above!'
  
  const dispatch = createEventDispatcher()
  
  function handleDelete(event) {
    dispatch('delete', event.detail)
  }
  
  function handleToggleComplete(event) {
    dispatch('toggleComplete', event.detail)
  }
</script>

<div class="bg-white rounded-lg shadow-md p-6 mb-6">
  <h2 class="text-xl font-semibold mb-4">{title} ({todos.length})</h2>
  {#if todos.length > 0}
    <div class="space-y-3">
      {#each todos as { id, text, completed, assignee, createdBy, key }}
        <TodoItem 
          {id}
          {text}
          {completed}
          {assignee}
          {createdBy}
          todoKey={key}
          on:delete={handleDelete}
          on:toggleComplete={handleToggleComplete}
        />
      {/each}
    </div>
  {:else}
    <p class="text-gray-500 text-center py-8">{emptyMessage}</p>
  {/if}
</div>