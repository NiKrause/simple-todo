<script>
  export let message = null
  export let duration = 3000
  export let type = 'default' // 'success', 'error', 'warning', 'default'
  
  // Auto-hide functionality
  let timeoutId
  
  $: if (message && duration > 0) {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      message = null
    }, duration)
  }
  
  // Different styles based on type
  $: toastClasses = getToastClasses(type)
  
  function getToastClasses(type) {
    const baseClasses = "fixed top-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded shadow-lg z-50 transition-opacity duration-300"
    
    switch (type) {
      case 'success':
        return `${baseClasses} bg-green-600 text-white`
      case 'error':
        return `${baseClasses} bg-red-600 text-white`
      case 'warning':
        return `${baseClasses} bg-yellow-600 text-white`
      default:
        return `${baseClasses} bg-gray-900 text-white`
    }
  }
</script>

{#if message}
  <div class={toastClasses}>
    {message}
  </div>
{/if}
