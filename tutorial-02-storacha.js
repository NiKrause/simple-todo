#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

class TutorialAutomator {
	constructor() {
		// Define the file mapping from source (root project) to destination (new project)
		this.sourceFiles = new Map([
			// Step 1: Config files
			['package.json', 'package.json'],
			['vite.config.js', 'vite.config.js'],
			['tailwind.config.js', 'tailwind.config.js'],
			['src/app.css', 'src/app.css'],
			['.env.example', '.env'], // Copy .env.example to .env

			// Step 2: Core P2P files
			['src/lib/libp2p-config.js', 'src/lib/libp2p-config.js'],
			['src/lib/p2p.js', 'src/lib/p2p.js'],
			['src/lib/db-actions.js', 'src/lib/db-actions.js'],
			['src/lib/utils.js', 'src/lib/utils.js'],

			// Step 3: UI Components - Core
			['src/lib/ConsentModal.svelte', 'src/lib/ConsentModal.svelte'],
			['src/lib/LoadingSpinner.svelte', 'src/lib/LoadingSpinner.svelte'],
			['src/lib/ErrorAlert.svelte', 'src/lib/ErrorAlert.svelte'],
			['src/lib/ToastNotification.svelte', 'src/lib/ToastNotification.svelte'],

			// Step 3: UI Components - Todo
			['src/lib/AddTodoForm.svelte', 'src/lib/AddTodoForm.svelte'],
			['src/lib/TodoItem.svelte', 'src/lib/TodoItem.svelte'],
			['src/lib/TodoList.svelte', 'src/lib/TodoList.svelte'],

			// Step 3: UI Components - P2P Status
			['src/lib/TransportBadge.svelte', 'src/lib/TransportBadge.svelte'],
			['src/lib/ConnectedPeers.svelte', 'src/lib/ConnectedPeers.svelte'],

			// Step 3: UI Components - Additional (optional)
			['src/lib/PeerIdCard.svelte', 'src/lib/PeerIdCard.svelte'],
			['src/lib/SocialIcons.svelte', 'src/lib/SocialIcons.svelte'],
			['src/lib/StorachaIntegration.svelte', 'src/lib/StorachaIntegration.svelte'],
			['src/lib/storacha-backup.js', 'src/lib/storacha-backup.js'],

			// Step 3: App Structure
			['src/routes/+layout.js', 'src/routes/+layout.js'],
			['src/routes/+layout.svelte', 'src/routes/+layout.svelte'],
			['src/routes/+page.svelte', 'src/routes/+page.svelte'],

			// Configuration files (optional)
			['svelte.config.js', 'svelte.config.js'],
			['eslint.config.js', 'eslint.config.js'],
			['vitest-setup-client.js', 'vitest-setup-client.js']
		]);
	}

	async checkSourceFiles() {
		console.log('📋 Checking source files...');
		const missingFiles = [];
		const foundFiles = [];

		for (const [sourcePath] of this.sourceFiles) {
			const fullPath = path.join(__dirname, sourcePath);
			try {
				await fs.access(fullPath);
				console.log(`✅ Found: ${sourcePath}`);
				foundFiles.push(sourcePath);
			} catch {
				console.log(`⚠️  Missing: ${sourcePath}`);
				missingFiles.push(sourcePath);
			}
		}

		if (foundFiles.length === 0) {
			console.error('\n❌ No source files found. Cannot continue.');
			return false;
		}

		console.log(`\n✅ Found ${foundFiles.length} source files!`);
		if (missingFiles.length > 0) {
			console.log(`⚠️  ${missingFiles.length} optional files missing (will be skipped)`);
		}

		return true;
	}

	async createSvelteProject(projectName) {
		console.log(`\n🚀 Step 0: Creating SvelteKit project "${projectName}"`);

		// Check if directory exists
		try {
			await fs.access(projectName);
			const overwrite = await this.askUser(
				`⚠️  Directory "${projectName}" exists. Continue? (y/n): `
			);
			if (overwrite.toLowerCase() !== 'y') {
				return false;
			}
		} catch {
			// Directory doesn't exist - good!
		}

		const createCommand = `npx sv create ${projectName} --template minimal --types jsdoc --install pnpm --no-add-ons`;
		console.log(`🔧 Running: ${createCommand}`);

		try {
			execSync(createCommand, { stdio: 'inherit' });
			process.chdir(projectName);

			console.log('\n📦 Adding SvelteKit add-ons...');
			const addCommand =
				'npx sv add prettier eslint vitest=usages:unit,component playwright tailwindcss=plugins:typography,form sveltekit-adapter=adapter:static --install pnpm --no-git-check ';
			console.log(`🔧 Running: ${addCommand}`);
			execSync(addCommand, { stdio: 'inherit' });

			return true;
		} catch (error) {
			console.error('❌ Failed to create project:', error.message);
			return false;
		}
	}

	async copyFile(sourcePath, destPath) {
		const fullSourcePath = path.join(__dirname, sourcePath);

		try {
			// Check if source file exists
			await fs.access(fullSourcePath);

			// Ensure destination directory exists
			await this.ensureDirectory(path.dirname(destPath));

			// Copy the file
			const content = await fs.readFile(fullSourcePath, 'utf-8');
			await fs.writeFile(destPath, content);

			console.log(`✅ Copied: ${sourcePath} → ${destPath}`);
			return true;
		} catch (error) {
			console.log(
				`⚠️  Skipped ${sourcePath}: ${error.code === 'ENOENT' ? 'file not found' : error.message}`
			);
			return false;
		}
	}

	async copyFilesWithPrompt(stepFiles, stepName) {
		console.log(`\n📋 ${stepName} files to copy:`);
		stepFiles.forEach((file, index) => {
			console.log(`   ${index + 1}. ${file}`);
		});

		const choice = await this.askUser(
			'\n📝 Copy files: (a)ll at once, (o)ne by one, or (s)kip? (a/o/s): '
		);

		let copiedCount = 0;

		if (choice.toLowerCase() === 's' || choice.toLowerCase() === 'skip') {
			console.log('⏭️  Skipping this step');
			return 0;
		} else if (
			choice.toLowerCase() === 'a' ||
			choice.toLowerCase() === 'all' ||
			choice.toLowerCase() === ''
		) {
			// Copy all files at once
			console.log('\n🚀 Copying all files...');
			for (const destPath of stepFiles) {
				const sourcePath = [...this.sourceFiles.entries()].find(
					([, dest]) => dest === destPath
				)?.[0];
				if (sourcePath) {
					const result = await this.copyFile(sourcePath, destPath);
					if (result) copiedCount++;
				}
			}
		} else if (choice.toLowerCase() === 'o' || choice.toLowerCase() === 'one') {
			// Copy files one by one with prompts
			console.log('\n📝 Copy files one by one (press Enter to copy, s to skip):');
			for (const destPath of stepFiles) {
				const sourcePath = [...this.sourceFiles.entries()].find(
					([, dest]) => dest === destPath
				)?.[0];
				if (sourcePath) {
					const copyChoice = await this.askUser(`   Copy ${destPath}? (Enter/s): `);
					if (copyChoice.toLowerCase() !== 's' && copyChoice.toLowerCase() !== 'skip') {
						const result = await this.copyFile(sourcePath, destPath);
						if (result) copiedCount++;
					} else {
						console.log(`   ⏭️  Skipped: ${destPath}`);
					}
				}
			}
		}

		return copiedCount;
	}

	async executeStep1() {
		console.log('\n📦 Step 1: Project Setup & Dependencies');

		const step1Files = [
			'package.json',
			'vite.config.js',
			'tailwind.config.js',
			'src/app.css',
			'.env'
		];

		const copiedCount = await this.copyFilesWithPrompt(step1Files, 'Step 1');

		if (copiedCount > 0 && this.sourceFiles.has('package.json')) {
			console.log('\n📦 Installing P2P dependencies (this will take a few minutes)...');
			try {
				execSync('pnpm install', { stdio: 'inherit' });
				console.log('✅ All dependencies installed');
			} catch {
				console.error('❌ Failed to install dependencies');
				return false;
			}
		}

		console.log(`✅ Step 1 complete: ${copiedCount} files copied`);
		return copiedCount > 0;
	}

	async executeStep2() {
		console.log('\n🔗 Step 2: Core P2P & Database Logic');

		const step2Files = [
			'src/lib/libp2p-config.js',
			'src/lib/p2p.js',
			'src/lib/db-actions.js',
			'src/lib/utils.js'
		];

		const copiedCount = await this.copyFilesWithPrompt(step2Files, 'Step 2');

		console.log(`✅ Step 2 complete: ${copiedCount} files copied`);
		return copiedCount > 0;
	}

	async executeStep3() {
		console.log('\n🎨 Step 3: UI Components');

		const step3Files = [
			// Core components
			'src/lib/ConsentModal.svelte',
			'src/lib/LoadingSpinner.svelte',
			'src/lib/ErrorAlert.svelte',
			'src/lib/ToastNotification.svelte',
			// Todo components
			'src/lib/AddTodoForm.svelte',
			'src/lib/TodoItem.svelte',
			'src/lib/TodoList.svelte',
			// P2P components
			'src/lib/TransportBadge.svelte',
			'src/lib/ConnectedPeers.svelte',
			// Additional components (optional)
			'src/lib/PeerIdCard.svelte',
			'src/lib/SocialIcons.svelte',
			'src/lib/StorachaIntegration.svelte',
			'src/lib/storacha-backup.js',
			// App structure
			'src/routes/+layout.js',
			'src/routes/+layout.svelte',
			'src/routes/+page.svelte',
			// Config files (optional)
			'svelte.config.js',
			'eslint.config.js',
			'vitest-setup-client.js'
		];

		const copiedCount = await this.copyFilesWithPrompt(step3Files, 'Step 3');

		console.log(`✅ Step 3 complete: ${copiedCount} files copied`);
		return copiedCount > 0;
	}

	async ensureDirectory(dirPath) {
		if (dirPath && dirPath !== '.' && dirPath !== '') {
			await fs.mkdir(dirPath, { recursive: true });
		}
	}

	async askUser(question) {
		return new Promise((resolve) => {
			rl.question(question, resolve);
		});
	}

	async run() {
		console.log('🎯 P2P Todo App - Tutorial Automation Script');
		console.log('===========================================\n');

		try {
			// Check source files
			const filesExist = await this.checkSourceFiles();
			if (!filesExist) {
				return;
			}

			await this.askUser('\n📖 Source files verified. Press Enter to continue...');

			// Get project name from user
			const projectName =
				(await this.askUser('📝 Enter project name (default: p2p-todo-demo): ')) || 'p2p-todo-demo';

			// Step 0: Create SvelteKit project
			console.log('\n' + '='.repeat(50));
			const projectCreated = await this.createSvelteProject(projectName);
			if (!projectCreated) {
				console.log('❌ Project creation cancelled');
				return;
			}

			await this.askUser('\n✅ SvelteKit project created. Press Enter to continue with Step 1...');

			// Step 1: Dependencies & Config
			console.log('\n' + '='.repeat(50));
			const step1Success = await this.executeStep1();
			if (!step1Success) {
				console.log('⚠️  Step 1 completed with no files copied');
			}

			await this.askUser('\n✅ Step 1 complete. Press Enter to continue with Step 2...');

			// Step 2: Core P2P Logic
			console.log('\n' + '='.repeat(50));
			const step2Success = await this.executeStep2();
			if (!step2Success) {
				console.log('⚠️  Step 2 completed with no files copied');
			}

			await this.askUser('\n✅ Step 2 complete. Press Enter to continue with Step 3...');

			// Step 3: UI Components
			console.log('\n' + '='.repeat(50));
			const step3Success = await this.executeStep3();
			if (!step3Success) {
				console.log('⚠️  Step 3 completed with no files copied');
			}

			// Success!
			console.log('\n' + '='.repeat(50));
			console.log('🎉 TUTORIAL AUTOMATION COMPLETE! 🎉');
			console.log('='.repeat(50));

			console.log('\n📋 Your P2P Todo App is ready!');
			console.log('\n🚀 Next steps:');
			console.log('   1. Run: pnpm dev');
			console.log('   2. Open http://localhost:5173 in TWO browser windows');
			console.log('   3. Accept the consent modal in both windows');
			console.log('   4. Add todos and watch them sync in real-time!');

			const startServer = await this.askUser('\n🌐 Start the development server now? (y/n): ');

			if (startServer.toLowerCase() === 'y' || startServer.toLowerCase() === 'yes') {
				console.log('\n🚀 Starting development server...');
				console.log(
					'💡 Open http://localhost:5173 in multiple browser windows to see P2P magic!\n'
				);

				try {
					execSync('pnpm dev', { stdio: 'inherit' });
				} catch {
					console.log('\n✅ Development server stopped.');
				}
			} else {
				console.log("\n✨ Run `pnpm dev` when you're ready to test the app!");
			}
		} catch (error) {
			console.error('\n❌ Automation failed:', error.message);
			console.error('\n🔧 You may need to complete the remaining steps manually.');
		} finally {
			rl.close();
		}
	}
}

// Execute the automation
const automator = new TutorialAutomator();
automator.run().catch((error) => {
	console.error('Fatal error:', error);
	process.exit(1);
});
