<script>
  import { onMount } from 'svelte'
  import { Cloud, Database, Download, Upload, Plus, List, Key, Mail, LogIn, LogOut, Loader2, AlertCircle, CheckCircle } from 'lucide-svelte'
  import * as Client from '@web3-storage/w3up-client'
  import { 
    initializeStorachaClient, 
    createStorachaAccount, 
    listSpaces, 
    createSpace, 
    backupTodoDatabase,
    listBackups,
    downloadBackupMetadata
  } from './storacha-backup.js'
  import { todosStore } from './db-actions.js'
  import { initializationStore } from './p2p.js'

  // Component state
  let showStoracha = false
  let isLoading = false
  let status = ''
  let error = null
  let success = null

  // Auth state
  let isLoggedIn = false
  let client = null
  let currentAccount = null
  let currentSpace = null
  
  // LocalStorage keys
  const STORAGE_KEYS = {
    STORACHA_KEY: 'storacha_key',
    STORACHA_PROOF: 'storacha_proof',
    AUTO_LOGIN: 'storacha_auto_login'
  }

  // Form state
  let showLoginForm = false
  let showCreateForm = false
  let showCredentialsForm = false
  let email = ''
  let storachaKey = ''
  let storachaProof = ''
  let newSpaceName = ''

  // Data state
  let spaces = []
  let backups = []
  let showSpaces = false
  let showBackups = false

  // LocalStorage functions
  function saveCredentials(key, proof) {
    try {
      console.log('💾 Saving credentials to localStorage...')
      localStorage.setItem(STORAGE_KEYS.STORACHA_KEY, key)
      localStorage.setItem(STORAGE_KEYS.STORACHA_PROOF, proof)
      localStorage.setItem(STORAGE_KEYS.AUTO_LOGIN, 'true')
      console.log('✅ Credentials saved successfully')
    } catch (err) {
      console.warn('❌ Failed to save credentials to localStorage:', err)
    }
  }
  
  function loadCredentials() {
    try {
      console.log('📖 Checking localStorage for credentials...')
      const key = localStorage.getItem(STORAGE_KEYS.STORACHA_KEY)
      const proof = localStorage.getItem(STORAGE_KEYS.STORACHA_PROOF)
      const autoLogin = localStorage.getItem(STORAGE_KEYS.AUTO_LOGIN)
      
      console.log('🔍 Found items:', {
        hasKey: !!key,
        hasProof: !!proof,
        autoLogin: autoLogin,
        autoLoginBool: autoLogin === 'true'
      })
      
      if (key && proof && autoLogin === 'true') {
        console.log('✅ Valid credentials found!')
        return { key, proof }
      } else {
        console.log('❌ No valid credentials found')
      }
    } catch (err) {
      console.warn('❌ Failed to load credentials from localStorage:', err)
    }
    return null
  }
  
  function clearStoredCredentials() {
    try {
      localStorage.removeItem(STORAGE_KEYS.STORACHA_KEY)
      localStorage.removeItem(STORAGE_KEYS.STORACHA_PROOF)
      localStorage.removeItem(STORAGE_KEYS.AUTO_LOGIN)
    } catch (err) {
      console.warn('Failed to clear credentials from localStorage:', err)
    }
  }
  
  function hasStoredCredentials() {
    // Quick check without calling loadCredentials() to avoid excessive logging
    try {
      const key = localStorage.getItem(STORAGE_KEYS.STORACHA_KEY)
      const proof = localStorage.getItem(STORAGE_KEYS.STORACHA_PROOF)
      const autoLogin = localStorage.getItem(STORAGE_KEYS.AUTO_LOGIN)
      return !!(key && proof && autoLogin === 'true')
    } catch (err) {
      return false
    }
  }

  // Auto-hide messages
  function showMessage(message, type = 'info') {
    if (type === 'error') {
      error = message
      success = null
    } else {
      success = message
      error = null
    }
    
    setTimeout(() => {
      error = null
      success = null
    }, 5000)
  }

  // Clear forms
  function clearForms() {
    showLoginForm = false
    showCreateForm = false  
    showCredentialsForm = false
    email = ''
    storachaKey = ''
    storachaProof = ''
    newSpaceName = ''
  }

  // Login with email
  async function handleEmailLogin() {
    if (!email.trim()) {
      showMessage('Please enter your email address', 'error')
      return
    }

    isLoading = true
    status = 'Creating account...'
    
    try {
      const result = await createStorachaAccount(email.trim())
      
      if (result.success) {
        showMessage(result.message)
        clearForms()
      } else {
        showMessage(result.error, 'error')
      }
    } catch (err) {
      showMessage(`Failed to create account: ${err.message}`, 'error')
    } finally {
      isLoading = false
      status = ''
    }
  }

  // Login with credentials
  async function handleCredentialsLogin(useStoredCredentials = false) {
    console.log('🚀 handleCredentialsLogin called with useStoredCredentials =', useStoredCredentials)
    
    let keyToUse = storachaKey.trim()
    let proofToUse = storachaProof.trim()
    
    console.log('🔍 Form values:', { 
      hasKey: !!storachaKey.trim(), 
      hasProof: !!storachaProof.trim(),
      keyLength: storachaKey.trim().length,
      proofLength: storachaProof.trim().length
    })
    
    // If using stored credentials, load them
    if (useStoredCredentials) {
      console.log('🔄 Loading stored credentials for auto-login...')
      const stored = loadCredentials()
      if (!stored) {
        console.log('⚠️ Auto-login failed: no stored credentials')
        showMessage('No stored credentials found', 'error')
        return
      }
      keyToUse = stored.key
      proofToUse = stored.proof
      console.log('✅ Loaded stored credentials successfully')
    } else {
      console.log('🔐 Manual login with form credentials')
    }
    
    if (!keyToUse || !proofToUse) {
      showMessage('Please provide both Storacha key and proof', 'error')
      return
    }

    isLoading = true
    status = useStoredCredentials ? 'Auto-logging in...' : 'Logging in...'

    try {
      client = await initializeStorachaClient(keyToUse, proofToUse)
      
      // For credential-based login, check current space instead of accounts
      currentSpace = client.currentSpace()
      if (currentSpace) {
        // Credential-based login successful
        currentAccount = null // No traditional account for credential login
        isLoggedIn = true
        
        // Save credentials for future auto-login (only if not already stored)
        if (!useStoredCredentials) {
          saveCredentials(keyToUse, proofToUse)
          showMessage('Successfully logged in to Storacha! Credentials saved for auto-login.')
        } else {
          showMessage('Successfully auto-logged in to Storacha!')
        }
        
        clearForms()
        
        // Load spaces (will handle credential-based client properly)
        await loadSpaces()
      } else {
        // Try traditional account-based approach as fallback
        const accounts = client.accounts()
        if (accounts.length > 0) {
          currentAccount = accounts[0]
          isLoggedIn = true
          
          if (!useStoredCredentials) {
            saveCredentials(keyToUse, proofToUse)
            showMessage('Successfully logged in to Storacha! Credentials saved for auto-login.')
          } else {
            showMessage('Successfully auto-logged in to Storacha!')
          }
          
          clearForms()
          await loadSpaces()
        } else {
          throw new Error('Failed to authenticate - no space or account found')
        }
      }
    } catch (err) {
      showMessage(`Login failed: ${err.message}`, 'error')
      // If auto-login failed, clear stored credentials
      if (useStoredCredentials) {
        clearStoredCredentials()
      }
    } finally {
      isLoading = false
      status = ''
    }
  }

  // Logout
  function handleLogout() {
    isLoggedIn = false
    client = null
    currentAccount = null
    currentSpace = null
    spaces = []
    backups = []
    showSpaces = false
    showBackups = false
    clearForms()
    clearStoredCredentials() // Clear stored credentials on logout
    showMessage('Logged out successfully')
  }

  // Load spaces
  async function loadSpaces() {
    if (!client) return

    isLoading = true
    status = 'Loading spaces...'

    try {
      spaces = await listSpaces(client)
      showSpaces = true
    } catch (err) {
      showMessage(`Failed to load spaces: ${err.message}`, 'error')
    } finally {
      isLoading = false
      status = ''
    }
  }

  // Create new space
  async function handleCreateSpace() {
    if (!newSpaceName.trim()) {
      showMessage('Please enter a space name', 'error')
      return
    }

    isLoading = true
    status = 'Creating space...'

    try {
      const result = await createSpace(client, newSpaceName.trim())
      
      if (result.success) {
        showMessage(`Space "${newSpaceName}" created successfully!`)
        newSpaceName = ''
        await loadSpaces() // Reload spaces
      } else {
        showMessage(result.error, 'error')
      }
    } catch (err) {
      showMessage(`Failed to create space: ${err.message}`, 'error')
    } finally {
      isLoading = false
      status = ''
    }
  }

  // Set current space
  async function selectSpace(space) {
    isLoading = true
    status = 'Switching space...'

    try {
      await client.setCurrentSpace(space.did)
      currentSpace = space
      showMessage(`Switched to space: ${space.name}`)
    } catch (err) {
      showMessage(`Failed to switch space: ${err.message}`, 'error')
    } finally {
      isLoading = false
      status = ''
    }
  }

  // Backup database
  async function handleBackup() {
    if (!client) {
      showMessage('Please log in first', 'error')
      return
    }

    if (!$initializationStore.isInitialized) {
      showMessage('OrbitDB is not initialized yet', 'error')
      return
    }

    if ($todosStore.length === 0) {
      showMessage('No todos to backup', 'error')
      return
    }

    isLoading = true
    status = 'Creating backup...'

    try {
      const result = await backupTodoDatabase(client)
      
      if (result.success) {
        showMessage(`Backup completed! ${result.blocksUploaded}/${result.blocksTotal} blocks uploaded`)
        // Auto-refresh backups list if it's open
        if (showBackups) {
          await loadBackups()
        }
      } else {
        showMessage(result.error, 'error')
      }
    } catch (err) {
      showMessage(`Backup failed: ${err.message}`, 'error')
    } finally {
      isLoading = false
      status = ''
    }
  }

  // Load backups
  async function loadBackups() {
    if (!client) return

    isLoading = true
    status = 'Loading backups...'

    try {
      backups = await listBackups(client)
      showBackups = true
    } catch (err) {
      showMessage(`Failed to load backups: ${err.message}`, 'error')
    } finally {
      isLoading = false
      status = ''
    }
  }

  // View backup details
  async function viewBackupDetails(backup) {
    isLoading = true
    status = 'Loading backup details...'

    try {
      const metadata = await downloadBackupMetadata(backup.cid)
      
      // Show backup details in alert for now
      const details = [
        `Database: ${metadata.databaseInfo.name}`,
        `Created: ${new Date(metadata.timestamp).toLocaleString()}`,
        `Blocks: ${Object.values(metadata.blockSummary).reduce((a, b) => a + b, 0)}`,
        `Manifest CID: ${metadata.databaseInfo.manifestCID}`,
        `App Version: ${metadata.appInfo.version}`
      ].join('\n')
      
      alert(`Backup Details:\n\n${details}`)
    } catch (err) {
      showMessage(`Failed to load backup details: ${err.message}`, 'error')
    } finally {
      isLoading = false
      status = ''
    }
  }

  // Format date
  function formatDate(dateString) {
    return new Date(dateString).toLocaleString()
  }

  // Format space name
  function formatSpaceName(space) {
    return space.name === 'Unnamed Space' ? `Space ${space.did.slice(-8)}` : space.name
  }
  
  // Auto-login on component mount
  onMount(async () => {
    console.log('🚀 StorachaIntegration component mounted')
    
    // Try to auto-login with stored credentials (but don't show error for first-time users)
    const stored = loadCredentials()
    if (stored) {
      console.log('🔐 Found stored Storacha credentials, attempting auto-login...')
      try {
        await handleCredentialsLogin(true)
      } catch (err) {
        console.warn('⚠️ Auto-login failed, clearing stored credentials:', err)
        clearStoredCredentials()
      }
    } else {
      console.log('🔒 No stored credentials found, user needs to login manually')
    }
  })
</script>

<div class="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700 dark:to-gray-600 rounded-lg border border-blue-200 dark:border-gray-600">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4">
    <div class="flex items-center space-x-2">
      <Cloud class="w-5 h-5 text-blue-600 dark:text-blue-400" />
      <h3 class="text-lg font-semibold text-gray-800 dark:text-white">Storacha Integration</h3>
    </div>
    
    <button
      on:click={() => showStoracha = !showStoracha}
      class="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 transition-colors"
    >
      {showStoracha ? 'Hide' : 'Show'}
    </button>
  </div>

  {#if showStoracha}
    <!-- Status Messages -->
    {#if error}
      <div class="mb-4 p-3 bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-600 rounded-md">
        <div class="flex items-center space-x-2">
          <AlertCircle class="w-4 h-4 text-red-600 dark:text-red-400" />
          <span class="text-red-700 dark:text-red-300 text-sm">{error}</span>
        </div>
      </div>
    {/if}

    {#if success}
      <div class="mb-4 p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-600 rounded-md">
        <div class="flex items-center space-x-2">
          <CheckCircle class="w-4 h-4 text-green-600 dark:text-green-400" />
          <span class="text-green-700 dark:text-green-300 text-sm">{success}</span>
        </div>
      </div>
    {/if}

    {#if status}
      <div class="mb-4 p-3 bg-blue-100 dark:bg-blue-900/30 border border-blue-300 dark:border-blue-600 rounded-md">
        <div class="flex items-center space-x-2">
          <Loader2 class="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin" />
          <span class="text-blue-700 dark:text-blue-300 text-sm">{status}</span>
        </div>
      </div>
    {/if}

    {#if !isLoggedIn}
      <!-- Login Section -->
      <div class="space-y-4">
        <div class="text-center text-gray-600 dark:text-gray-300 text-sm">
          Connect to Storacha to backup your todos to decentralized storage
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            on:click={() => { clearForms(); showCreateForm = true; }}
            disabled={isLoading}
            class="flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            <Mail class="w-4 h-4" />
            <span>Create New Account</span>
          </button>

          <button
            on:click={() => { clearForms(); showCredentialsForm = true; }}
            disabled={isLoading}
            class="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            <Key class="w-4 h-4" />
            <span>Login with Credentials</span>
          </button>
        </div>

        <!-- Create Account Form -->
        {#if showCreateForm}
          <div class="p-4 bg-white dark:bg-gray-700 rounded-md border">
            <h4 class="text-md font-medium mb-3 text-gray-800 dark:text-white">Create New Storacha Account</h4>
            <div class="space-y-3">
              <input
                bind:value={email}
                type="email"
                placeholder="Enter your email address"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div class="flex space-x-2">
                <button
                  on:click={handleEmailLogin}
                  disabled={isLoading || !email.trim()}
                  class="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md transition-colors"
                >
                  {isLoading ? 'Creating...' : 'Create Account'}
                </button>
                <button
                  on:click={clearForms}
                  class="px-4 py-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- Credentials Form -->
        {#if showCredentialsForm}
          <div class="p-4 bg-white dark:bg-gray-700 rounded-md border">
            <h4 class="text-md font-medium mb-3 text-gray-800 dark:text-white">Login with Storacha Credentials</h4>
            <div class="space-y-3">
              <input
                bind:value={storachaKey}
                type="password"
                placeholder="Storacha Private Key"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
              <textarea
                bind:value={storachaProof}
                placeholder="Storacha Proof (delegation)"
                rows="3"
                class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-xs resize-none"
              ></textarea>
              <div class="flex space-x-2">
                <button
                  on:click={() => handleCredentialsLogin()}
                  disabled={isLoading || !storachaKey.trim() || !storachaProof.trim()}
                  class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
                >
                  {isLoading ? 'Logging in...' : 'Login'}
                </button>
                <button
                  on:click={clearForms}
                  class="px-4 py-2 bg-gray-300 dark:bg-gray-600 hover:bg-gray-400 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-200 rounded-md transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <!-- Logged In Section -->
      <div class="space-y-4">
        <!-- Account Info -->
        <div class="flex items-center justify-between p-3 bg-white dark:bg-gray-700 rounded-md border">
          <div class="flex items-center space-x-3">
            <div class="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <CheckCircle class="w-4 h-4 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <div class="text-sm font-medium text-gray-800 dark:text-white">Connected to Storacha</div>
              {#if currentSpace}
                <div class="text-xs text-gray-500 dark:text-gray-400">Current space: {formatSpaceName(currentSpace)}</div>
              {/if}
            </div>
          </div>
          
          <button
            on:click={handleLogout}
            class="flex items-center space-x-1 px-3 py-1 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm transition-colors"
          >
            <LogOut class="w-3 h-3" />
            <span>Logout</span>
          </button>
        </div>

        <!-- Action Buttons -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            on:click={loadSpaces}
            disabled={isLoading}
            class="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            <List class="w-4 h-4" />
            <span>Manage Spaces</span>
          </button>

          <button
            on:click={handleBackup}
            disabled={isLoading || !$initializationStore.isInitialized || $todosStore.length === 0}
            class="flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            <Upload class="w-4 h-4" />
            <span>Backup Database</span>
          </button>

          <button
            on:click={loadBackups}
            disabled={isLoading}
            class="flex items-center justify-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-md transition-colors"
          >
            <Database class="w-4 h-4" />
            <span>View Backups</span>
          </button>
        </div>

        <!-- Spaces Management -->
        {#if showSpaces}
          <div class="p-4 bg-white dark:bg-gray-700 rounded-md border">
            <h4 class="text-md font-medium mb-3 text-gray-800 dark:text-white flex items-center space-x-2">
              <List class="w-4 h-4" />
              <span>Spaces ({spaces.length})</span>
            </h4>
            
            <!-- Create New Space -->
            <div class="mb-4 flex space-x-2">
              <input
                bind:value={newSpaceName}
                placeholder="New space name"
                class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
              />
              <button
                on:click={handleCreateSpace}
                disabled={isLoading || !newSpaceName.trim()}
                class="px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                <Plus class="w-4 h-4" />
              </button>
            </div>

            <!-- Spaces List -->
            {#if spaces.length === 0}
              <div class="text-center text-gray-500 dark:text-gray-400 text-sm py-4">
                No spaces found
              </div>
            {:else}
              <div class="space-y-2 max-h-40 overflow-y-auto">
                {#each spaces as space}
                  <div class="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-600 rounded border">
                    <div>
                      <div class="text-sm font-medium text-gray-800 dark:text-white">{formatSpaceName(space)}</div>
                      <div class="text-xs text-gray-500 dark:text-gray-400 font-mono">{space.did.slice(0, 20)}...</div>
                    </div>
                    {#if currentSpace?.did !== space.did}
                      <button
                        on:click={() => selectSpace(space)}
                        class="px-2 py-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm transition-colors"
                      >
                        Select
                      </button>
                    {:else}
                      <span class="px-2 py-1 text-green-600 dark:text-green-400 text-sm font-medium">
                        Current
                      </span>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <!-- Backups List -->
        {#if showBackups}
          <div class="p-4 bg-white dark:bg-gray-700 rounded-md border">
            <h4 class="text-md font-medium mb-3 text-gray-800 dark:text-white flex items-center space-x-2">
              <Database class="w-4 h-4" />
              <span>Backups ({backups.length})</span>
            </h4>
            
            {#if backups.length === 0}
              <div class="text-center text-gray-500 dark:text-gray-400 text-sm py-4">
                No backups found
              </div>
            {:else}
              <div class="space-y-2 max-h-60 overflow-y-auto">
                {#each backups as backup}
                  <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-600 rounded border">
                    <div class="flex-1">
                      <div class="text-sm font-medium text-gray-800 dark:text-white">{backup.databaseName}</div>
                      <div class="text-xs text-gray-500 dark:text-gray-400">
                        {formatDate(backup.timestamp)} • {backup.blockCount} blocks
                      </div>
                      <div class="text-xs text-gray-400 dark:text-gray-500 font-mono">{backup.cid.slice(0, 32)}...</div>
                    </div>
                    <button
                      on:click={() => viewBackupDetails(backup)}
                      class="px-2 py-1 text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 text-sm transition-colors"
                    >
                      Details
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  /* Custom scrollbar for webkit browsers */
  .overflow-y-auto::-webkit-scrollbar {
    width: 4px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.1);
    border-radius: 2px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.3);
    border-radius: 2px;
  }
  
  .overflow-y-auto::-webkit-scrollbar-thumb:hover {
    background: rgba(0, 0, 0, 0.4);
  }
</style>
