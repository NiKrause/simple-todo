<script>
	import { onMount } from 'svelte';
	import {
		Cloud,
		Upload,
		Plus,
		List,
		Key,
		LogOut,
		Loader2,
		AlertCircle,
		CheckCircle,
		Download
	} from 'lucide-svelte';
	import {
		initializeStorachaClient,
		initializeStorachaClientWithUCAN,
		listSpaces,
		createSpace,
		getSpaceUsage
	} from './storacha-backup.js';
	import { OrbitDBStorachaBridge } from 'orbitdb-storacha-bridge';
	import { todosStore } from './db-actions.js';
	import { initializationStore, orbitDBStore } from './p2p.js';
	import { loadTodos, todoDBStore } from './db-actions.js';

	// Component state
	let showStoracha = true; // Start expanded by default
	let isLoading = false;
	// eslint-disable-next-line no-unused-vars
	let status = ''; // Used for internal state tracking, could be displayed in UI
	let error = null;
	let success = null;

	// Auth state
	let isLoggedIn = false;
	let client = null;
	let currentSpace = null;

	// Progress tracking state
	let showProgress = false;
	let progressType = ''; // 'upload' or 'download'
	let progressCurrent = 0;
	let progressTotal = 0;
	let progressPercentage = 0;
	let progressCurrentBlock = null;
	let progressError = null;

	// Bridge instance
	let bridge = null;

	// LocalStorage keys
	const STORAGE_KEYS = {
		STORACHA_KEY: 'storacha_key',
		STORACHA_PROOF: 'storacha_proof',
		UCAN_TOKEN: 'storacha_ucan_token',
		RECIPIENT_KEY: 'storacha_recipient_key',
		AUTH_METHOD: 'storacha_auth_method',
		AUTO_LOGIN: 'storacha_auto_login'
	};

	// Form state
	let showCredentialsForm = false;
	let authMethod = 'credentials'; // 'credentials' or 'ucan'
	let storachaKey = '';
	let storachaProof = '';
	let ucanToken = '';
	let recipientKey = '';
	let newSpaceName = '';

	// Data state
	let spaces = [];
	let spaceUsage = null; // Will contain file count and last upload info

	// Progress tracking functions
	function initializeBridge(authMethod, authData) {
		if (bridge) {
			// Remove existing listeners
			bridge.removeAllListeners();
		}

		const bridgeOptions = {};

		if (authMethod === 'credentials') {
			bridgeOptions.storachaKey = authData.key;
			bridgeOptions.storachaProof = authData.proof;
		} else if (authMethod === 'ucan') {
			// UCAN authentication support
			if (!client) {
				throw new Error('UCAN client is required but not available');
			}

			bridgeOptions.ucanClient = client;

			// Get current space DID if available
			try {
				const currentSpace = client.currentSpace();
				if (currentSpace) {
					bridgeOptions.spaceDID = currentSpace.did();
				}
			} catch (error) {
				console.warn('Could not get current space DID:', error.message);
			}
		} else {
			throw new Error(`Bridge with ${authMethod} authentication not yet implemented`);
		}

		bridge = new OrbitDBStorachaBridge(bridgeOptions);

		// Set up progress event listeners
		bridge.on('uploadProgress', (progress) => {
			console.log(
				`Upload Progress: ${progress.current}/${progress.total} (${progress.percentage}%)`
			);

			progressType = 'upload';
			progressCurrent = progress.current;
			progressTotal = progress.total;
			progressPercentage = progress.percentage;
			progressCurrentBlock = progress.currentBlock;
			progressError = progress.error;
			showProgress = true;

			// Update status text
			if (progress.error) {
				status = `Upload error: ${progress.error.message}`;
			} else if (progress.currentBlock) {
				status = `Uploading block ${progress.current} of ${progress.total} (${progress.currentBlock.hash.slice(0, 8)}...)`;
			} else {
				status = `Uploading block ${progress.current} of ${progress.total}`;
			}
		});

		bridge.on('downloadProgress', (progress) => {
			console.log(
				`Download Progress: ${progress.current}/${progress.total} (${progress.percentage}%)`
			);

			progressType = 'download';
			progressCurrent = progress.current;
			progressTotal = progress.total;
			progressPercentage = progress.percentage;
			progressCurrentBlock = progress.currentBlock;
			progressError = progress.error;
			showProgress = true;

			// Update status text
			if (progress.error) {
				status = `Download error: ${progress.error.message}`;
			} else if (progress.currentBlock) {
				status = `Downloading block ${progress.current} of ${progress.total} (${progress.currentBlock.storachaCID.slice(0, 8)}...)`;
			} else {
				status = `Downloading block ${progress.current} of ${progress.total}`;
			}
		});

		return bridge;
	}

	function resetProgress() {
		showProgress = false;
		progressType = '';
		progressCurrent = 0;
		progressTotal = 0;
		progressPercentage = 0;
		progressCurrentBlock = null;
		progressError = null;
	}

	// LocalStorage functions
	function saveCredentials(method, data) {
		try {
			console.log(`💾 Saving ${method} credentials to localStorage...`);
			localStorage.setItem(STORAGE_KEYS.AUTH_METHOD, method);
			localStorage.setItem(STORAGE_KEYS.AUTO_LOGIN, 'true');

			if (method === 'credentials') {
				localStorage.setItem(STORAGE_KEYS.STORACHA_KEY, data.key);
				localStorage.setItem(STORAGE_KEYS.STORACHA_PROOF, data.proof);
			} else if (method === 'ucan') {
				localStorage.setItem(STORAGE_KEYS.UCAN_TOKEN, data.ucanToken);
				localStorage.setItem(STORAGE_KEYS.RECIPIENT_KEY, data.recipientKey);
			}

			console.log('✅ Credentials saved successfully');
		} catch (err) {
			console.warn('❌ Failed to save credentials to localStorage:', err);
		}
	}

	function loadCredentials() {
		try {
			console.log('📖 Checking localStorage for credentials...');
			const method = localStorage.getItem(STORAGE_KEYS.AUTH_METHOD) || 'credentials';
			const autoLogin = localStorage.getItem(STORAGE_KEYS.AUTO_LOGIN);

			if (autoLogin !== 'true') {
				console.log('❌ Auto-login disabled');
				return null;
			}

			if (method === 'credentials') {
				const key = localStorage.getItem(STORAGE_KEYS.STORACHA_KEY);
				const proof = localStorage.getItem(STORAGE_KEYS.STORACHA_PROOF);
				if (key && proof) {
					console.log('✅ Valid credentials found!');
					return { method, key, proof };
				}
			} else if (method === 'ucan') {
				const ucanToken = localStorage.getItem(STORAGE_KEYS.UCAN_TOKEN);
				const recipientKey = localStorage.getItem(STORAGE_KEYS.RECIPIENT_KEY);
				if (ucanToken && recipientKey) {
					console.log('✅ Valid UCAN credentials found!');
					return { method, ucanToken, recipientKey };
				}
			}

			console.log('❌ No valid credentials found');
		} catch (err) {
			console.warn('❌ Failed to load credentials from localStorage:', err);
		}
		return null;
	}

	function clearStoredCredentials() {
		try {
			Object.values(STORAGE_KEYS).forEach((key) => {
				localStorage.removeItem(key);
			});
		} catch (err) {
			console.warn('Failed to clear credentials from localStorage:', err);
		}
	}

	// Auto-hide messages
	function showMessage(message, type = 'info') {
		if (type === 'error') {
			error = message;
			success = null;
		} else {
			success = message;
			error = null;
		}

		setTimeout(() => {
			error = null;
			success = null;
		}, 5000);
	}

	// Clear forms
	function clearForms() {
		showCredentialsForm = false;
		storachaKey = '';
		storachaProof = '';
		ucanToken = '';
		recipientKey = '';
		newSpaceName = '';
	}

	// Login with credentials
	async function handleCredentialsLogin(useStoredCredentials = false) {
		console.log(
			'🚀 handleCredentialsLogin called with useStoredCredentials =',
			useStoredCredentials
		);

		let keyToUse = storachaKey.trim();
		let proofToUse = storachaProof.trim();

		console.log('🔍 Form values:', {
			hasKey: !!storachaKey.trim(),
			hasProof: !!storachaProof.trim(),
			keyLength: storachaKey.trim().length,
			proofLength: storachaProof.trim().length
		});

		// If using stored credentials, load them
		if (useStoredCredentials) {
			console.log('🔄 Loading stored credentials for auto-login...');
			const stored = loadCredentials();
			if (!stored) {
				console.log('⚠️ Auto-login failed: no stored credentials');
				showMessage('No stored credentials found', 'error');
				return;
			}
			keyToUse = stored.key;
			proofToUse = stored.proof;
			console.log('✅ Loaded stored credentials successfully');
		} else {
			console.log('🔐 Manual login with form credentials');
		}

		if (!keyToUse || !proofToUse) {
			showMessage('Please provide both Storacha key and proof', 'error');
			return;
		}

		isLoading = true;
		status = useStoredCredentials ? 'Auto-logging in...' : 'Logging in...';

		try {
			client = await initializeStorachaClient(keyToUse, proofToUse);

			// Initialize the bridge with credentials
			initializeBridge('credentials', { key: keyToUse, proof: proofToUse });

			// For credential-based login, check current space instead of accounts
			currentSpace = client.currentSpace();
			if (currentSpace) {
				// Credential-based login successful
				isLoggedIn = true;

				// Save credentials for future auto-login (only if not already stored)
				if (!useStoredCredentials) {
					saveCredentials('credentials', { key: keyToUse, proof: proofToUse });
					showMessage('Successfully logged in to Storacha! Credentials saved for auto-login.');
				} else {
					showMessage('Successfully auto-logged in to Storacha!');
				}

				clearForms();

				// Load spaces (will handle credential-based client properly)
				await loadSpaces();
			} else {
				// Try traditional account-based approach as fallback
				const accounts = client.accounts();
				if (accounts.length > 0) {
					isLoggedIn = true;

					if (!useStoredCredentials) {
						saveCredentials('credentials', { key: keyToUse, proof: proofToUse });
						showMessage('Successfully logged in to Storacha! Credentials saved for auto-login.');
					} else {
						showMessage('Successfully auto-logged in to Storacha!');
					}

					clearForms();
					await loadSpaces();
				} else {
					throw new Error('Failed to authenticate - no space or account found');
				}
			}
		} catch (err) {
			showMessage(`Login failed: ${err.message}`, 'error');
			// If auto-login failed, clear stored credentials
			if (useStoredCredentials) {
				clearStoredCredentials();
			}
		} finally {
			isLoading = false;
			status = '';
		}
	}

	// Login with UCAN
	async function handleUCANLogin(useStoredCredentials = false) {
		console.log('🚀 handleUCANLogin called with useStoredCredentials =', useStoredCredentials);

		let tokenToUse = ucanToken.trim();
		let keyToUse = recipientKey.trim();

		// If using stored credentials, load them
		if (useStoredCredentials) {
			console.log('🔄 Loading stored UCAN credentials for auto-login...');
			const stored = loadCredentials();
			if (!stored || stored.method !== 'ucan') {
				console.log('⚠️ UCAN auto-login failed: no stored credentials');
				showMessage('No stored UCAN credentials found', 'error');
				return;
			}
			tokenToUse = stored.ucanToken;
			keyToUse = stored.recipientKey;
			console.log('✅ Loaded stored UCAN credentials successfully');
		} else {
			console.log('🎫 Manual UCAN login with form credentials');
		}

		if (!tokenToUse || !keyToUse) {
			showMessage('Please provide both UCAN token and recipient key', 'error');
			return;
		}

		isLoading = true;
		status = useStoredCredentials ? 'Auto-logging in with UCAN...' : 'Logging in with UCAN...';

		try {
			client = await initializeStorachaClientWithUCAN(tokenToUse, keyToUse);

			// Initialize the bridge with UCAN support
			initializeBridge('ucan', { ucanToken: tokenToUse, recipientKey: keyToUse });

			currentSpace = client.currentSpace();
			if (currentSpace) {
				isLoggedIn = true;

				if (!useStoredCredentials) {
					saveCredentials('ucan', { ucanToken: tokenToUse, recipientKey: keyToUse });
					showMessage(
						'Successfully logged in to Storacha with UCAN! Credentials saved for auto-login.'
					);
				} else {
					showMessage('Successfully auto-logged in to Storacha with UCAN!');
				}

				clearForms();
				await loadSpaces();
			} else {
				throw new Error('Failed to authenticate with UCAN - no space found');
			}
		} catch (err) {
			showMessage(`UCAN login failed: ${err.message}`, 'error');
			if (useStoredCredentials) {
				clearStoredCredentials();
			}
		} finally {
			isLoading = false;
			status = '';
		}
	}

	// Logout
	function handleLogout() {
		isLoggedIn = false;
		client = null;
		currentSpace = null;
		spaces = [];
		spaceUsage = null; // Clear space usage info
		clearForms();
		clearStoredCredentials(); // Clear stored credentials on logout

		// Clean up bridge
		if (bridge) {
			bridge.removeAllListeners();
			bridge = null;
		}

		resetProgress();
		showMessage('Logged out successfully');
	}

	// Load space usage information
	async function loadSpaceUsage() {
		if (!client) return;

		try {
			spaceUsage = await getSpaceUsage(client);
			console.log('📊 Space usage loaded:', spaceUsage);
		} catch (err) {
			console.warn('⚠️ Failed to load space usage info:', err.message);
			spaceUsage = null;
		}
	}

	// Load spaces
	async function loadSpaces() {
		if (!client) return;

		isLoading = true;
		status = 'Loading spaces...';

		try {
			spaces = await listSpaces(client);
			// Also load space usage information
			await loadSpaceUsage();
		} catch (err) {
			showMessage(`Failed to load spaces: ${err.message}`, 'error');
		} finally {
			isLoading = false;
			status = '';
		}
	}

	// Create new space
	async function handleCreateSpace() {
		if (!newSpaceName.trim()) {
			showMessage('Please enter a space name', 'error');
			return;
		}

		isLoading = true;
		status = 'Creating space...';

		try {
			const result = await createSpace(client, newSpaceName.trim());

			if (result.success) {
				showMessage(`Space "${newSpaceName}" created successfully!`);
				newSpaceName = '';
				await loadSpaces(); // Reload spaces
			} else {
				showMessage(result.error, 'error');
			}
		} catch (err) {
			showMessage(`Failed to create space: ${err.message}`, 'error');
		} finally {
			isLoading = false;
			status = '';
		}
	}

	// Set current space
	async function selectSpace(space) {
		isLoading = true;
		status = 'Switching space...';

		try {
			await client.setCurrentSpace(space.did);
			currentSpace = space;
			showMessage(`Switched to space: ${space.name}`);
		} catch (err) {
			showMessage(`Failed to switch space: ${err.message}`, 'error');
		} finally {
			isLoading = false;
			status = '';
		}
	}

	// Backup database with progress tracking
	async function handleBackup() {
		if (!bridge) {
			showMessage('Please log in first', 'error');
			return;
		}

		if (!$initializationStore.isInitialized) {
			showMessage('OrbitDB is not initialized yet', 'error');
			return;
		}

		if ($todosStore.length === 0) {
			showMessage('No todos to backup', 'error');
			return;
		}

		isLoading = true;
		resetProgress();
		status = 'Preparing backup...';

		try {
			console.log('🚀 Starting backup with real progress tracking...', $todoDBStore);

			const result = await bridge.backup($orbitDBStore, $todoDBStore.address);

			if (result.success) {
				showMessage(
					`Backup completed! ${result.blocksUploaded}/${result.blocksTotal} blocks uploaded`
				);
			} else {
				showMessage(result.error, 'error');
			}
		} catch (err) {
			showMessage(`Backup failed: ${err.message}`, 'error');
		} finally {
			isLoading = false;
			status = '';
			resetProgress();
		}
	}

	// Format date (currently unused but may be needed for future features)
	// function formatDate(dateString) {
	// 	return new Date(dateString).toLocaleString();
	// }

	// Format relative time for space usage
	function formatRelativeTime(dateString) {
		if (!dateString) return 'Never';

		const date = new Date(dateString);
		const now = new Date();
		const diffInSeconds = Math.floor((now - date) / 1000);

		if (diffInSeconds < 60) return 'Just now';
		if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
		if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
		if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;
		if (diffInSeconds < 31536000) return `${Math.floor(diffInSeconds / 2592000)} months ago`;
		return `${Math.floor(diffInSeconds / 31536000)} years ago`;
	}

	// Format space name
	function formatSpaceName(space) {
		return space.name === 'Unnamed Space' ? `Space ${space.did.slice(-8)}` : space.name;
	}

	// Auto-login on component mount
	onMount(async () => {
		console.log('🚀 StorachaIntegration component mounted');

		// Try to auto-login with stored credentials (but don't show error for first-time users)
		const stored = loadCredentials();
		if (stored) {
			console.log(`🔐 Found stored ${stored.method} credentials, attempting auto-login...`);

			// Set the auth method and form values from stored credentials
			authMethod = stored.method;

			try {
				if (stored.method === 'credentials') {
					storachaKey = stored.key;
					storachaProof = stored.proof;
					await handleCredentialsLogin(true);
				} else if (stored.method === 'ucan') {
					ucanToken = stored.ucanToken;
					recipientKey = stored.recipientKey;
					await handleUCANLogin(true);
				}
			} catch (err) {
				console.warn('⚠️ Auto-login failed, clearing stored credentials:', err);
				clearStoredCredentials();
			}
		} else {
			console.log('🔒 No stored credentials found, user needs to login manually');
		}
	});

	// Fallback-only restore (more reliable but loses some metadata)
	async function restoreFromSpaceFallback() {
		if (!$orbitDBStore) {
			showMessage('OrbitDB not initialized. Please wait for initialization to complete.', 'error');
			return;
		}

		isLoading = true;
		resetProgress();
		status = 'Preparing fallback restore...';

		try {
			console.log('🔄 Starting fallback-only restore from Storacha space...');

			// Get Storacha credentials based on authentication method
			const stored = loadCredentials();
			if (!stored) {
				throw new Error('Storacha credentials not found. Please login to Storacha first.');
			}

			// Clean up existing database before restore to prevent conflicts
			status = 'Cleaning up existing database...';
			console.log('🧹 Cleaning up existing database before restore...');

			try {
				// Close and clean up existing todo database
				if ($todoDBStore) {
					console.log('📥 Closing existing todo database...');
					await $todoDBStore.close();
					todoDBStore.set(null);
				}

				// Try to drop any existing databases with common names
				const commonNames = ['simple-todos', 'test-todos', 'restored-todos'];
				for (const dbName of commonNames) {
					try {
						const existingDB = await $orbitDBStore.open(dbName, { type: 'keyvalue' });
						console.log(`🗑️ Dropping existing database '${dbName}':`, existingDB.address);
						await existingDB.drop();
						await existingDB.close();
					} catch {
						console.log(`ℹ️ No existing '${dbName}' database to drop`);
					}
				}
			} catch (cleanupError) {
				console.warn('⚠️ Cleanup warning (continuing anyway):', cleanupError.message);
			}

			// Use the current OrbitDB instance for fallback restore with progress tracking
			status = 'Starting fallback restore...';
			console.log('🔄 Using fallback restore method with current OrbitDB instance...');

			// Initialize bridge for progress tracking if not already initialized
			if (!bridge) {
				initializeBridge(stored.method, stored);
			}

			// Use unique database name to prevent conflicts
			const uniqueDbName = `restored-todos-${Date.now()}`;
			console.log('🆆 Using unique database name:', uniqueDbName);

			// Use fallback reconstruction directly (as requested)
			const result = await bridge.restoreFromSpace($orbitDBStore, {
				timeout: 180000, // 3 minutes timeout for fallback reconstruction
				forceFallback: true, // Force fallback reconstruction (works reliably)
				fallbackDatabaseName: uniqueDbName,
				dbConfig: {
					type: 'keyvalue',
					create: true
				}
			});

			console.log('Fallback restore result:', result);

			if (result.success) {
				// Update the todo database store with the restored database
				todoDBStore.set(result.database);

				// Load todos from the restored database
				await loadTodos();

				showMessage(
					`Restore completed! ${result.entriesRecovered} entries recovered to database '${uniqueDbName}'.`
				);

				console.log('🎉 Fallback restore completed:', {
					restoredAddress: result.database.address,
					entriesRecovered: result.entriesRecovered,
					method: result.method
				});
			} else {
				showMessage(`Fallback restore failed: ${result.error}`, 'error');
			}
		} catch (error) {
			console.error('❌ Fallback restore failed:', error);
			showMessage(`Fallback restore failed: ${error.message}`, 'error');
		} finally {
			isLoading = false;
			status = '';
			resetProgress();
		}
	}
</script>

<div
	class="max-h-[70vh] overflow-y-auto rounded-xl border border-blue-200/50 bg-white/95 p-4 shadow-2xl ring-1 ring-black/5 backdrop-blur-sm dark:border-gray-600/50 dark:bg-gray-800/95 dark:ring-white/10"
	style="backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);"
>
	<!-- Header -->
	<div
		class="mb-4 flex items-center justify-between border-b border-gray-200/50 pb-3 dark:border-gray-700/50"
	>
		<div class="flex items-center space-x-2">
			<div class="rounded-lg bg-gradient-to-r from-blue-500 to-purple-600 p-2">
				<Cloud class="h-5 w-5 text-white" />
			</div>
			<div>
				<h3 class="text-lg font-semibold text-gray-800 dark:text-white">Decentralized Storage</h3>
				<p class="text-xs text-gray-500 dark:text-gray-400">Storacha Integration</p>
			</div>
		</div>

		<button
			on:click={() => (showStoracha = !showStoracha)}
			class="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
			title={showStoracha ? 'Collapse' : 'Expand'}
			aria-label={showStoracha ? 'Collapse Storacha panel' : 'Expand Storacha panel'}
		>
			<svg
				class="h-4 w-4 transform transition-transform duration-200 {showStoracha
					? 'rotate-180'
					: ''}"
				fill="none"
				viewBox="0 0 24 24"
				stroke="currentColor"
			>
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</button>
	</div>

	{#if showStoracha}
		<!-- OrbitDB Initialization Status -->
		{#if !$initializationStore.isInitialized}
			<div
				class="mb-4 rounded-md border border-yellow-300 bg-yellow-100 p-3 dark:border-yellow-600 dark:bg-yellow-900/30"
			>
				<div class="flex items-center space-x-2">
					<Loader2 class="h-4 w-4 animate-spin text-yellow-600 dark:text-yellow-400" />
					<div class="text-sm">
						<div class="font-medium text-yellow-800 dark:text-yellow-200">Database Not Ready</div>
						<div class="text-yellow-700 dark:text-yellow-300">
							OrbitDB is still initializing. You can login to Storacha, but backup/restore will be
							disabled until initialization completes.
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Status Messages -->
		{#if error}
			<div
				class="mb-4 rounded-md border border-red-300 bg-red-100 p-3 dark:border-red-600 dark:bg-red-900/30"
			>
				<div class="flex items-center space-x-2">
					<AlertCircle class="h-4 w-4 text-red-600 dark:text-red-400" />
					<span class="text-sm text-red-700 dark:text-red-300">{error}</span>
				</div>
			</div>
		{/if}

		{#if success}
			<div
				class="mb-4 rounded-md border border-green-300 bg-green-100 p-3 dark:border-green-600 dark:bg-green-900/30"
			>
				<div class="flex items-center space-x-2">
					<CheckCircle class="h-4 w-4 text-green-600 dark:text-green-400" />
					<span class="text-sm text-green-700 dark:text-green-300">{success}</span>
				</div>
			</div>
		{/if}

		<!-- Progress Bar -->
		{#if showProgress}
			<div
				class="mb-4 rounded-md border border-purple-300 bg-purple-100 p-3 dark:border-purple-600 dark:bg-purple-900/30"
			>
				<div class="mb-2 flex items-center justify-between text-sm">
					<span class="font-medium text-purple-800 dark:text-purple-200">
						{progressType === 'upload' ? 'Uploading' : 'Downloading'} Progress
					</span>
					<span class="text-purple-700 dark:text-purple-300">
						{progressPercentage}% ({progressCurrent}/{progressTotal})
					</span>
				</div>
				<div class="h-2 w-full rounded-full bg-purple-200 dark:bg-purple-700">
					<div
						class="h-2 rounded-full bg-purple-600 transition-all duration-300 ease-out dark:bg-purple-400"
						style="width: {progressPercentage}%"
					></div>
				</div>
				{#if progressCurrentBlock}
					<div class="mt-1 font-mono text-xs text-purple-600 dark:text-purple-400">
						{progressType === 'upload' ? 'Current block hash:' : 'Current CID:'}
						{progressType === 'upload'
							? progressCurrentBlock.hash?.slice(0, 16)
							: progressCurrentBlock.storachaCID?.slice(0, 16)}...
					</div>
				{/if}
				{#if progressError}
					<div class="mt-1 text-xs text-red-600 dark:text-red-400">
						Error: {progressError.message}
					</div>
				{/if}
			</div>
		{/if}

		{#if !isLoggedIn}
			<!-- Login Section -->
			<div class="space-y-4">
				<div class="text-center text-sm text-gray-600 dark:text-gray-300">
					Connect to Storacha to backup your todos to decentralized storage
				</div>

				<!-- Authentication Method Toggle -->
				<div class="mb-4 flex justify-center">
					<div class="rounded-lg border bg-gray-100 p-1 dark:bg-gray-700">
						<button
							on:click={() => (authMethod = 'credentials')}
							class="rounded-md px-4 py-2 text-sm transition-colors {authMethod === 'credentials'
								? 'bg-blue-600 text-white'
								: 'text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-600'}"
						>
							🔑 Credentials
						</button>
						<button
							on:click={() => (authMethod = 'ucan')}
							class="rounded-md px-4 py-2 text-sm transition-colors {authMethod === 'ucan'
								? 'bg-blue-600 text-white'
								: 'text-gray-700 hover:bg-gray-200 dark:text-gray-300 dark:hover:bg-gray-600'}"
						>
							🎫 UCAN
						</button>
					</div>
				</div>

				<div class="flex justify-center">
					<button
						on:click={() => {
							clearForms();
							showCredentialsForm = true;
						}}
						disabled={isLoading}
						class="flex items-center justify-center space-x-2 rounded-md bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
					>
						<Key class="h-4 w-4" />
						<span>Login with {authMethod === 'credentials' ? 'Credentials' : 'UCAN'}</span>
					</button>
				</div>

				<!-- Authentication Forms -->
				{#if showCredentialsForm}
					<div class="rounded-md border bg-white p-4 dark:bg-gray-700">
						{#if authMethod === 'credentials'}
							<!-- Credentials Form -->
							<h4 class="text-md mb-3 font-medium text-gray-800 dark:text-white">
								Storacha Key & Proof
							</h4>
							<div class="space-y-3">
								<input
									bind:value={storachaKey}
									type="password"
									placeholder="Private Key (MgCZ9...)"
									class="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
								/>
								<textarea
									bind:value={storachaProof}
									placeholder="Proof/Delegation (uCAIS...)"
									rows="3"
									class="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
								></textarea>
								<div class="flex space-x-2">
									<button
										on:click={() => handleCredentialsLogin()}
										disabled={isLoading || !storachaKey.trim() || !storachaProof.trim()}
										class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
									>
										{isLoading ? 'Logging in...' : 'Login'}
									</button>
									<button
										on:click={clearForms}
										class="rounded-md bg-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-400 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
									>
										Cancel
									</button>
								</div>
							</div>
						{:else}
							<!-- UCAN Form -->
							<h4 class="text-md mb-3 font-medium text-gray-800 dark:text-white">
								UCAN Delegation
							</h4>
							<div class="space-y-3">
								<textarea
									bind:value={ucanToken}
									placeholder="UCAN Token (Base64 encoded, eyJh...)"
									rows="3"
									class="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
								></textarea>
								<textarea
									bind:value={recipientKey}
									placeholder="Recipient Key (JSON: did:key with keys object)"
									rows="3"
									class="w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
								></textarea>
								<div class="flex space-x-2">
									<button
										on:click={() => handleUCANLogin()}
										disabled={isLoading || !ucanToken.trim() || !recipientKey.trim()}
										class="flex-1 rounded-md bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
									>
										{isLoading ? 'Logging in...' : 'Login'}
									</button>
									<button
										on:click={clearForms}
										class="rounded-md bg-gray-300 px-4 py-2 text-gray-700 transition-colors hover:bg-gray-400 dark:bg-gray-600 dark:text-gray-200 dark:hover:bg-gray-500"
									>
										Cancel
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<!-- Logged In Section -->
			<div class="space-y-4">
				<!-- Account Info -->
				<div
					class="flex items-center justify-between rounded-md border bg-white p-3 dark:bg-gray-700"
				>
					<div class="flex items-center space-x-3">
						<div
							class="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30"
						>
							<CheckCircle class="h-4 w-4 text-green-600 dark:text-green-400" />
						</div>
						<div>
							<div class="text-sm font-medium text-gray-800 dark:text-white">
								Connected to Storacha
							</div>
							{#if currentSpace}
								<div class="text-xs text-gray-500 dark:text-gray-400">
									Current space: {formatSpaceName(currentSpace)}
								</div>
							{/if}
						</div>
					</div>

					<button
						on:click={handleLogout}
						class="flex items-center space-x-1 px-3 py-1 text-sm text-red-600 transition-colors hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
					>
						<LogOut class="h-3 w-3" />
						<span>Logout</span>
					</button>
				</div>

				<!-- Action Buttons -->
				<div class="space-y-3">
					<!-- Backup Button -->
					<button
						on:click={handleBackup}
						disabled={isLoading || !$initializationStore.isInitialized || $todosStore.length === 0}
						class="flex w-full items-center justify-center space-x-2 rounded-md bg-green-600 px-4 py-2 text-white transition-colors hover:bg-green-700 disabled:opacity-50"
					>
						<Upload class="h-4 w-4" />
						<span>Backup Database</span>
					</button>

					<!-- Restore Button -->
					<button
						on:click={restoreFromSpaceFallback}
						disabled={isLoading || !$initializationStore.isInitialized}
						class="flex w-full items-center justify-center space-x-2 rounded-md bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
						title="Restore database from Storacha backup"
					>
						<Download class="h-4 w-4" />
						<span>Restore</span>
					</button>
				</div>

				<!-- Spaces Management -->
				<div class="rounded-md border bg-white p-4 dark:bg-gray-700">
					<div class="mb-3 flex items-center justify-between">
						<h4 class="flex items-center space-x-2 font-medium text-gray-800 dark:text-white">
							<List class="h-4 w-4" />
							<span>Spaces ({spaces.length})</span>
						</h4>
						<div class="flex items-center space-x-1">
							<button
								on:click={loadSpaceUsage}
								disabled={isLoading}
								class="rounded p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:text-gray-300"
								title="Refresh space usage"
								aria-label="Refresh space usage"
							>
								<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
									/>
								</svg>
							</button>
							{#if spaceUsage && spaceUsage.totalFiles <= 50 && !spaceUsage.analyzed}
								<button
									on:click={async () => {
										spaceUsage = await getSpaceUsage(client, true);
									}}
									disabled={isLoading}
									class="rounded p-1 text-blue-500 transition-colors hover:bg-blue-100 hover:text-blue-700 disabled:opacity-50 dark:text-blue-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
									title="Analyze file types"
									aria-label="Analyze file types"
								>
									<svg class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
										<path
											stroke-linecap="round"
											stroke-linejoin="round"
											stroke-width="2"
											d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
										/>
									</svg>
								</button>
							{/if}
						</div>
					</div>

					<!-- Space Usage Information -->
					{#if spaceUsage}
						<div
							class="mb-4 rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-600 dark:bg-gray-800"
						>
							<div class="flex items-center justify-between text-sm">
								<div class="flex items-center space-x-2">
									<div
										class="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30"
									>
										<span class="text-xs font-bold text-blue-600 dark:text-blue-400"
											>{spaceUsage.totalFiles}</span
										>
									</div>
									<span class="font-medium text-gray-700 dark:text-gray-300">
										file{spaceUsage.totalFiles !== 1 ? 's' : ''} stored
									</span>
								</div>
								{#if spaceUsage.lastUploadDate}
									<div class="text-gray-500 dark:text-gray-400">
										Last upload: {formatRelativeTime(spaceUsage.lastUploadDate)}
									</div>
								{/if}
							</div>

							<!-- File Type Breakdown -->
							{#if spaceUsage.totalFiles > 0}
								<div class="mt-2 grid grid-cols-3 gap-2 text-xs">
									{#if spaceUsage.backupFiles > 0}
										<div class="flex items-center space-x-1">
											<div class="h-2 w-2 rounded-full bg-green-500"></div>
											<span class="text-gray-600 dark:text-gray-400"
												>{spaceUsage.backupFiles} backup{spaceUsage.backupFiles !== 1
													? 's'
													: ''}</span
											>
										</div>
									{/if}
									{#if spaceUsage.blockFiles > 0}
										<div class="flex items-center space-x-1">
											<div class="h-2 w-2 rounded-full bg-blue-500"></div>
											<span class="text-gray-600 dark:text-gray-400"
												>{spaceUsage.blockFiles} data block{spaceUsage.blockFiles !== 1
													? 's'
													: ''}</span
											>
										</div>
									{/if}
									{#if spaceUsage.otherFiles > 0}
										<div class="flex items-center space-x-1">
											<div class="h-2 w-2 rounded-full bg-gray-500"></div>
											<span class="text-gray-600 dark:text-gray-400"
												>{spaceUsage.otherFiles} other</span
											>
										</div>
									{/if}
								</div>

								<div class="mt-2 text-xs text-gray-500 dark:text-gray-400">
									{#if spaceUsage.oldestUploadDate && spaceUsage.oldestUploadDate !== spaceUsage.lastUploadDate}
										Oldest upload: {formatRelativeTime(spaceUsage.oldestUploadDate)}<br />
									{/if}
									<em>Note: Each backup creates many data blocks</em>
								</div>
							{/if}
						</div>
					{:else if spaceUsage === null && isLoggedIn}
						<div
							class="mb-4 rounded border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-600 dark:bg-yellow-900/30"
						>
							<div class="text-sm text-yellow-700 dark:text-yellow-300">
								Space usage information unavailable
							</div>
						</div>
					{/if}

					<!-- Create New Space -->
					<div class="mb-4 flex space-x-2">
						<input
							bind:value={newSpaceName}
							placeholder="New space name"
							class="flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800 dark:text-white"
						/>
						<button
							on:click={handleCreateSpace}
							disabled={isLoading || !newSpaceName.trim()}
							class="rounded-md bg-green-600 px-3 py-2 text-white transition-colors hover:bg-green-700 disabled:opacity-50"
						>
							<Plus class="h-4 w-4" />
						</button>
					</div>

					<!-- Spaces List -->
					{#if spaces.length === 0}
						<div class="py-4 text-center text-sm text-gray-500 dark:text-gray-400">
							No spaces found
						</div>
					{:else}
						<div class="max-h-40 space-y-2 overflow-y-auto">
							{#each spaces as space (space.did)}
								<div
									class="flex items-center justify-between rounded border bg-gray-50 p-2 dark:bg-gray-600"
								>
									<div>
										<div class="text-sm font-medium text-gray-800 dark:text-white">
											{formatSpaceName(space)}
										</div>
										<div class="font-mono text-xs text-gray-500 dark:text-gray-400">
											{space.did.slice(0, 20)}...
										</div>
									</div>
									{#if currentSpace?.did !== space.did}
										<button
											on:click={() => selectSpace(space)}
											class="px-2 py-1 text-sm text-blue-600 transition-colors hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
										>
											Select
										</button>
									{:else}
										<span class="px-2 py-1 text-sm font-medium text-green-600 dark:text-green-400">
											Current
										</span>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
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
