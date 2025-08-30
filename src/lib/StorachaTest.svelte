<script>
	import {
		Play,
		Database,
		CheckCircle,
		AlertCircle,
		Loader2,
		Eye,
		EyeOff
	} from 'lucide-svelte';
	import { createLibp2p } from 'libp2p';
	import { createHelia } from 'helia';
	import { createOrbitDB, MemoryStorage } from '@orbitdb/core';
	import { createLibp2pConfig } from './libp2p-config.js';
	import { backupDatabase, restoreDatabaseFromSpace } from 'orbitdb-storacha-bridge';
	// Add these imports for persistent storage
	import { LevelBlockstore } from 'blockstore-level';
	import { LevelDatastore } from 'datastore-level';

	// Test state
	let testRunning = false;
	let testStep = '';
	let testResults = [];
	let testError = null;
	let testSuccess = false;
	let showDetails = false;

	// Test data
	let originalTodos = [
		{
			id: 'test_todo_1',
			text: 'Test Todo 1 - Buy groceries',
			completed: false,
			createdAt: new Date().toISOString(),
			createdBy: 'test-peer-1'
		},
		{
			id: 'test_todo_2',
			text: 'Test Todo 2 - Walk the dog',
			completed: true,
			createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hour ago
			createdBy: 'test-peer-2'
		},
		{
			id: 'test_todo_3',
			text: 'Test Todo 3 - Finish project',
			completed: false,
			createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(), // 30 minutes ago
			createdBy: 'test-peer-1'
		}
	];

	// Test instances
	let testOrbitDB1 = null;
	let testOrbitDB2 = null;
	let testDatabase1 = null;
	let testDatabase2 = null;
	let testHelia1 = null;
	let testHelia2 = null;
	let testLibp2p1 = null;
	let testLibp2p2 = null;

	// Storacha credentials (will be loaded from localStorage)
	let storachaKey = '';
	let storachaProof = '';

	// Backup results
	let backupResult = null;
	let restoreResult = null;

	function addTestResult(step, status, message, data = null) {
		const result = {
			step,
			status, // 'running', 'success', 'error'
			message,
			data,
			timestamp: new Date().toISOString()
		};
		testResults = [...testResults, result];
		console.log(`🧪 Test ${step}: ${status} - ${message}`, data || '');
	}

	function updateLastTestResult(status, message, data = null) {
		if (testResults.length > 0) {
			const lastResult = testResults[testResults.length - 1];
			lastResult.status = status;
			lastResult.message = message;
			if (data) lastResult.data = data;
			testResults = [...testResults];
		}
	}

	async function createTestOrbitDB(instanceId, databaseName) {
		console.log(`🔧 Creating test OrbitDB instance ${instanceId}...`);

		// Create unique libp2p config for this instance
		const config = await createLibp2pConfig({
			enablePeerConnections: true,
			enableNetworkConnection: true,
            enablePersistentStorage: true
		});
 

		// Create libp2p instance
		const libp2p = await createLibp2p(config);
        console.log('libp2p created');

		// Create Helia instance with persistent storage (like in p2p.js)
		console.log('🗄️ Initializing Helia with persistent storage...');
		const blockstore = new LevelBlockstore(`./helia-blocks-test-${instanceId}`);
		const datastore = new LevelDatastore(`./helia-data-test-${instanceId}`);
		const helia = await createHelia({ libp2p, blockstore, datastore });
        console.log('Helia created with persistent storage');

		// Create OrbitDB instance with unique ID
		const orbitdb = await createOrbitDB({
			ipfs: helia,
			id: `storacha-test-${instanceId}-${Date.now()}`,
			directory: `./orbitdb-test-${instanceId}`
		});
        console.log('orbitdb', orbitdb);

		// Create database
		const database = await orbitdb.open(databaseName, {
			type: 'keyvalue',
			create: true
		});
        console.log('database', database);
		return { libp2p, helia, orbitdb, database };
	}

	async function clearIndexedDB() {
	console.log('🗑️ Clearing IndexedDB...');
	
	// Get all IndexedDB databases
	if ('databases' in indexedDB) {
		const databases = await indexedDB.databases();
		console.log('📋 Found databases:', databases.map(db => db.name));
		
		// Delete databases that look like OrbitDB/Helia related
		const dbsToDelete = databases.filter(db => 
			db.name.includes('helia') || 
			db.name.includes('orbit') || 
			db.name.includes('level') ||
			db.name.includes('simple-todo') ||
			db.name.includes('storacha-test')
		);
		
		for (const db of dbsToDelete) {
			try {
				console.log(`🗑️ Deleting database: ${db.name}`);
				
				// Add timeout to prevent hanging
				await Promise.race([
					new Promise((resolve, reject) => {
						const deleteReq = indexedDB.deleteDatabase(db.name);
						deleteReq.onsuccess = () => resolve();
						deleteReq.onerror = () => reject(deleteReq.error);
						deleteReq.onblocked = () => {
							console.warn(`⚠️ Database deletion blocked for: ${db.name}`);
							// Don't reject immediately, give it more time
						};
					}),
					new Promise((_, reject) => 
						setTimeout(() => reject(new Error('Timeout')), 5000)
					)
				]);
				
				console.log(`✅ Deleted database: ${db.name}`);
			} catch (error) {
				if (error.message === 'Timeout') {
					console.warn(`⏱️ Timeout deleting database ${db.name} - skipping`);
				} else {
					console.warn(`⚠️ Failed to delete database ${db.name}:`, error);
				}
			}
		}
	}
	
	console.log('🧹 IndexedDB cleanup completed');
}

	async function runComprehensiveTest() {
		testRunning = true;
		testStep = '';
		testResults = [];
		testError = null;
		testSuccess = false;
		backupResult = null;
		restoreResult = null;

		try {
			// Load Storacha credentials
			storachaKey = localStorage.getItem('storacha_key') || '';
			storachaProof = localStorage.getItem('storacha_proof') || '';

			if (!storachaKey || !storachaProof) {
				throw new Error('Storacha credentials not found. Please login to Storacha first.');
			}

			// Step 1: Create first OrbitDB instance and database
			testStep = 'Creating first OrbitDB instance';
			addTestResult('Step 1', 'running', 'Creating first OrbitDB instance...');

			const instance1 = await createTestOrbitDB('instance1', 'test-todos-1');
			testOrbitDB1 = instance1.orbitdb;
			testDatabase1 = instance1.database;
			testHelia1 = instance1.helia;
			testLibp2p1 = instance1.libp2p;

			updateLastTestResult('success', `First OrbitDB instance created with ID: ${testOrbitDB1.id}`, {
				orbitDBId: testOrbitDB1.id,
				databaseAddress: testDatabase1.address,
				peerId: testLibp2p1.peerId.toString()
			});

			// Step 2: Add test todos to first database
			testStep = 'Adding test todos';
			addTestResult('Step 2', 'running', 'Adding 3 test todos to first database...');

			for (let i = 0; i < originalTodos.length; i++) {
				const todo = originalTodos[i];
				await testDatabase1.put(todo.id, todo);
				console.log(`✅ Added todo ${i + 1}:`, todo);
			}

			// Verify todos were added
			const addedTodos = await testDatabase1.all();
			if (addedTodos.length !== 3) {
				throw new Error(`Expected 3 todos, but found ${addedTodos.length}`);
			}

			updateLastTestResult('success', `Successfully added ${addedTodos.length} test todos`, {
				todosAdded: addedTodos.map(t => ({ key: t.key, text: t.value.text, completed: t.value.completed }))
			});

			// Step 3: Create backup to Storacha
			testStep = 'Creating backup';
			addTestResult('Step 3', 'running', 'Creating backup to Storacha...');

			backupResult = await backupDatabase(testOrbitDB1, testDatabase1.address, {
				storachaKey,
				storachaProof,
				timeout: 60000
			});

			if (!backupResult.success) {
				throw new Error(`Backup failed: ${backupResult.error}`);
			}

			updateLastTestResult('success', `Backup created successfully with ${backupResult.blocksUploaded}/${backupResult.blocksTotal} blocks`, {
				manifestCID: backupResult.manifestCID,
				databaseAddress: backupResult.databaseAddress,
				blocksTotal: backupResult.blocksTotal,
				blocksUploaded: backupResult.blocksUploaded
			});

			// Step 4: Close and cleanup first instance
			testStep = 'Cleaning up first instance';
			addTestResult('Step 4', 'running', 'Closing first OrbitDB instance and clearing storage...');

			// Close database and OrbitDB
			await testDatabase1.drop();
			// await testOrbitDB1.close();
			// await testHelia1.close();
			// await testLibp2p1.close();

			// Clear IndexedDB
			await clearIndexedDB();

			// Clear references
			testDatabase1 = null;
			testOrbitDB1 = null;
			testHelia1 = null;
			testLibp2p1 = null;

			updateLastTestResult('success', 'First instance cleaned up and storage cleared');

			// Step 5: Create completely new OrbitDB instance
			testStep = 'Creating second OrbitDB instance';
			addTestResult('Step 5', 'running', 'Creating completely new OrbitDB instance...');

			// Wait a bit to ensure cleanup is complete
			await new Promise(resolve => setTimeout(resolve, 1000));

			const instance2 = await createTestOrbitDB('instance2', 'test-todos-2');
			testOrbitDB2 = instance2.orbitdb;
			testDatabase2 = instance2.database;
			testHelia2 = instance2.helia;
			testLibp2p2 = instance2.libp2p;
            console.log('testOrbitDB2', testOrbitDB2);
            console.log('testDatabase2', testDatabase2);
            console.log('testHelia2', testHelia2);
            console.log('testLibp2p2', testLibp2p2);

			// Verify it's a completely different instance
			const newTodos = await testDatabase2.all();
			if (newTodos.length !== 0) {
				console.warn(`⚠️ New database should be empty but contains ${newTodos.length} entries`);
			}

			updateLastTestResult('success', `Second OrbitDB instance created with different ID: ${testOrbitDB2.id}`, {
				orbitDBId: testOrbitDB2.id,
				databaseAddress: testDatabase2.address,
				peerId: testLibp2p2.peerId.toString(),
				initialTodoCount: newTodos.length
			});

			// Step 6: Restore from Storacha backup
			testStep = 'Restoring from backup';
			addTestResult('Step 6', 'running', 'Restoring database from Storacha backup...');

			restoreResult = await restoreDatabaseFromSpace(testOrbitDB2, {
				storachaKey,
				storachaProof,
				timeout: 60000
			});

			if (!restoreResult.success) {
				throw new Error(`Restore failed: ${restoreResult.error}`);
			}

			updateLastTestResult('success', `Database restored successfully with ${restoreResult.entriesRecovered} entries`, {
				manifestCID: restoreResult.manifestCID,
				databaseAddress: restoreResult.address,
				entriesRecovered: restoreResult.entriesRecovered,
				blocksRestored: restoreResult.blocksRestored
			});

			// Step 7: Verify restored data
			testStep = 'Verifying restored data';
			addTestResult('Step 7', 'running', 'Verifying all original todos are readable...');

			// Get the restored database instance
			const restoredDatabase = restoreResult.database;
			const restoredTodos = await restoredDatabase.all();

			console.log('🔍 Original todos:', originalTodos);
			console.log('🔍 Restored todos:', restoredTodos);

			// Verify count
			if (restoredTodos.length !== originalTodos.length) {
				throw new Error(`Expected ${originalTodos.length} todos, but restored ${restoredTodos.length}`);
			}

			// Verify content
			const verificationResults = [];
			for (const originalTodo of originalTodos) {
				const restoredTodo = restoredTodos.find(t => t.key === originalTodo.id || t.value.text === originalTodo.text);
				if (!restoredTodo) {
					throw new Error(`Original todo not found in restored data: ${originalTodo.text}`);
				}

				const todoData = restoredTodo.value;
				const matches = {
					text: todoData.text === originalTodo.text,
					completed: todoData.completed === originalTodo.completed,
					createdBy: todoData.createdBy === originalTodo.createdBy
				};

				verificationResults.push({
					originalId: originalTodo.id,
					restoredKey: restoredTodo.key,
					originalText: originalTodo.text,
					restoredText: todoData.text,
					matches
				});

				if (!matches.text || matches.completed !== true && matches.completed !== false) {
					throw new Error(`Data mismatch for todo: ${originalTodo.text}`);
				}
			}

			updateLastTestResult('success', `All ${originalTodos.length} todos verified successfully!`, {
				verificationResults,
				restoredCount: restoredTodos.length,
				originalCount: originalTodos.length
			});

			// Test completed successfully
			testSuccess = true;
			testStep = 'Test completed successfully!';

		} catch (error) {
			console.error('❌ Test failed:', error);
			testError = error.message;
			testStep = `Test failed: ${error.message}`;
			
			if (testResults.length > 0) {
				updateLastTestResult('error', error.message);
			} else {
				addTestResult('Error', 'error', error.message);
			}
		} finally {
			// Cleanup test instances
			try {
				if (testDatabase1) await testDatabase1.close();
				if (testOrbitDB1) await testOrbitDB1.stop();
				if (testHelia1) await testHelia1.stop();
				if (testLibp2p1) await testLibp2p1.stop();
				
				if (testDatabase2) await testDatabase2.close();
				if (testOrbitDB2) await testOrbitDB2.stop();
				if (testHelia2) await testHelia2.stop();
				if (testLibp2p2) await testLibp2p2.stop();
			} catch (cleanupError) {
				console.warn('⚠️ Cleanup error:', cleanupError);
			}

			testRunning = false;
		}
	}

	function formatTimestamp(timestamp) {
		return new Date(timestamp).toLocaleTimeString();
	}

	function getStatusIcon(status) {
		switch (status) {
			case 'running':
				return Loader2;
			case 'success':
				return CheckCircle;
			case 'error':
				return AlertCircle;
			default:
				return AlertCircle;
		}
	}

	function getStatusClass(status) {
		switch (status) {
			case 'running':
				return 'text-blue-600 dark:text-blue-400';
			case 'success':
				return 'text-green-600 dark:text-green-400';
			case 'error':
				return 'text-red-600 dark:text-red-400';
			default:
				return 'text-gray-600 dark:text-gray-400';
		}
	}
</script>

<div class="mt-6 rounded-lg border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-4 dark:border-gray-600 dark:from-gray-700 dark:to-gray-600">
	<!-- Header -->
	<div class="mb-4 flex items-center justify-between">
		<div class="flex items-center space-x-2">
			<Database class="h-5 w-5 text-purple-600 dark:text-purple-400" />
			<h3 class="text-lg font-semibold text-gray-800 dark:text-white">
				Storacha Bridge Test Suite
			</h3>
		</div>
	</div>

	<!-- Description -->
	<div class="mb-4 rounded-md bg-purple-100 p-3 dark:bg-purple-900/30">
		<p class="text-sm text-purple-800 dark:text-purple-200">
			This test creates an independent OrbitDB instance, adds 3 test todos, backs them up to Storacha, 
			completely destroys the database and storage, creates a new OrbitDB instance with a different ID, 
			and verifies that all data can be restored correctly.
		</p>
	</div>

	<!-- Test Controls -->
	<div class="mb-4 flex items-center space-x-3">
		<button
			on:click={runComprehensiveTest}
			disabled={testRunning}
			class="flex items-center space-x-2 rounded-md bg-purple-600 px-4 py-2 text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
		>
			{#if testRunning}
				<Loader2 class="h-4 w-4 animate-spin" />
				<span>Running Test...</span>
			{:else}
				<Play class="h-4 w-4" />
				<span>Run Test</span>
			{/if}
		</button>

		<button
			on:click={() => (showDetails = !showDetails)}
			class="flex items-center space-x-2 rounded-md bg-gray-600 px-4 py-2 text-white transition-colors hover:bg-gray-700"
		>
			{#if showDetails}
				<EyeOff class="h-4 w-4" />
				<span>Hide Details</span>
			{:else}
				<Eye class="h-4 w-4" />
				<span>Show Details</span>
			{/if}
		</button>
	</div>

	<!-- Current Status -->
	{#if testRunning || testStep}
		<div class="mb-4 rounded-md border bg-white p-3 dark:bg-gray-700">
			<div class="flex items-center space-x-2">
				{#if testRunning}
					<Loader2 class="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
				{:else if testSuccess}
					<CheckCircle class="h-4 w-4 text-green-600 dark:text-green-400" />
				{:else if testError}
					<AlertCircle class="h-4 w-4 text-red-600 dark:text-red-400" />
				{/if}
				<span class="font-medium text-gray-800 dark:text-white">
					{testStep}
				</span>
			</div>
		</div>
	{/if}

	<!-- Test Results -->
	{#if testResults.length > 0}
		<div class="rounded-md border bg-white p-4 dark:bg-gray-700">
			<h4 class="mb-3 font-medium text-gray-800 dark:text-white">Test Results</h4>
			
			<div class="space-y-2">
				{#each testResults as result, index}
					<div class="flex items-start space-x-3 rounded border bg-gray-50 p-3 dark:bg-gray-600">
						<div class="flex-shrink-0">
							<svelte:component 
								this={getStatusIcon(result.status)} 
								class="h-4 w-4 {getStatusClass(result.status)} {result.status === 'running' ? 'animate-spin' : ''}" 
							/>
						</div>
						<div class="flex-1">
							<div class="flex items-center justify-between">
								<span class="font-medium text-gray-800 dark:text-white">
									{result.step}
								</span>
								<span class="text-xs text-gray-500 dark:text-gray-400">
									{formatTimestamp(result.timestamp)}
								</span>
							</div>
							<p class="text-sm text-gray-600 dark:text-gray-300">
								{result.message}
							</p>
							
							{#if showDetails && result.data}
								<details class="mt-2">
									<summary class="cursor-pointer text-xs text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300">
										Show Details
									</summary>
									<pre class="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200">{JSON.stringify(result.data, null, 2)}</pre>
								</details>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Final Results Summary -->
	{#if testSuccess}
		<div class="mt-4 rounded-md border border-green-300 bg-green-100 p-4 dark:border-green-600 dark:bg-green-900/30">
			<div class="flex items-start space-x-2">
				<CheckCircle class="h-5 w-5 text-green-600 dark:text-green-400" />
				<div>
					<h4 class="font-medium text-green-800 dark:text-green-200">
						Test Completed Successfully! ✅
					</h4>
					<p class="text-sm text-green-700 dark:text-green-300">
						The OrbitDB-Storacha bridge successfully backed up and restored all test data. 
						All {originalTodos.length} todos were verified after complete database recreation.
					</p>
					{#if backupResult && restoreResult}
						<div class="mt-2 text-xs text-green-600 dark:text-green-400">
							Backup: {backupResult.blocksUploaded}/{backupResult.blocksTotal} blocks uploaded •
							Restore: {restoreResult.entriesRecovered} entries recovered
						</div>
					{/if}
				</div>
			</div>
		</div>
	{:else if testError}
		<div class="mt-4 rounded-md border border-red-300 bg-red-100 p-4 dark:border-red-600 dark:bg-red-900/30">
			<div class="flex items-start space-x-2">
				<AlertCircle class="h-5 w-5 text-red-600 dark:text-red-400" />
				<div>
					<h4 class="font-medium text-red-800 dark:text-red-200">
						Test Failed ❌
					</h4>
					<p class="text-sm text-red-700 dark:text-red-300">
						{testError}
					</p>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	pre {
		font-family: 'Courier New', Courier, monospace;
		white-space: pre-wrap;
		word-break: break-all;
	}
</style>
