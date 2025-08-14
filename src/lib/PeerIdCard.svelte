<script>
  import { formatPeerId } from './utils.js'
  
  export let peerId = null
  export let title = 'My Peer ID'
  export let description = 'Share this ID with others to assign TODOs to you.'
  export let loadingMessage = 'Loading...'
  export let copyable = true
  
  let copied = false
  
  async function copyToClipboard() {
    if (!peerId || !copyable) return
    
    try {
      await navigator.clipboard.writeText(peerId)
      copied = true
      setTimeout(() => {
        copied = false
      }, 2000)
    } catch (err) {
      console.warn('Failed to copy to clipboard:', err)
      // Fallback for older browsers
      fallbackCopyToClipboard(peerId)
    }
  }
  
  function fallbackCopyToClipboard(text) {
    const textArea = document.createElement('textarea')
    textArea.value = text
    textArea.style.position = 'fixed'
    textArea.style.left = '-999999px'
    textArea.style.top = '-999999px'
    document.body.appendChild(textArea)
    textArea.focus()
    textArea.select()
    
    try {
      document.execCommand('copy')
      copied = true
      setTimeout(() => {
        copied = false
      }, 2000)
    } catch (err) {
      console.warn('Fallback copy failed:', err)
    }
    
    document.body.removeChild(textArea)
  }
</script>

<div class="bg-white rounded-lg shadow-md p-6">
  <h2 class="text-xl font-semibold mb-4">{title}</h2>
  {#if peerId}
    <div class="bg-blue-50 p-3 rounded-md relative">
      <code class="text-sm font-mono break-all select-all">{formatPeerId(peerId)}</code>
      {#if copyable}
        <button
          on:click={copyToClipboard}
          class="absolute top-2 right-2 p-1 rounded hover:bg-blue-200 transition-colors"
          title={copied ? 'Copied!' : 'Copy to clipboard'}
        >
          {#if copied}
            <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
            </svg>
          {:else}
            <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
            </svg>
          {/if}
        </button>
      {/if}
    </div>
    {#if description}
      <p class="text-sm text-gray-600 mt-2">{description}</p>
    {/if}
    {#if copied}
      <p class="text-sm text-green-600 mt-1 font-medium">Copied to clipboard!</p>
    {/if}
  {:else}
    <p class="text-gray-500">{loadingMessage}</p>
  {/if}
</div>