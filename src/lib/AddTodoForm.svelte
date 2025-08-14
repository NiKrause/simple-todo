<script>
  import { createEventDispatcher } from 'svelte'
  
  export let placeholder = 'What needs to be done?'
  export let buttonText = 'Add TODO'
  export let disabled = false
  
  let inputText = ''
  const dispatch = createEventDispatcher()
  
  function handleSubmit() {
    if (!inputText || inputText.trim() === '') return
    
    dispatch('add', {
      text: inputText.trim()
    })
    
    inputText = ''
  }
  
  function handleKeydown(event) {
    if (event.key === 'Enter') {
      handleSubmit()
    }
  }
</script>

<div class="bg-white rounded-lg shadow-md p-6 mb-6">
  <h2 class="text-xl font-semibold mb-4">Add New TODO</h2>
  <div class="space-y-4">
    <input
      type="text"
      bind:value={inputText}
      {placeholder}
      {disabled}
      class="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
      on:keydown={handleKeydown}
    />
    <div class="flex gap-2">
      <button 
        on:click={handleSubmit}
        {disabled}
        class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded-md font-medium transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
      >
        {buttonText}
      </button>
    </div>
  </div>
</div>
