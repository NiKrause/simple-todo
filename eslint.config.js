import prettier from 'eslint-config-prettier';
import { includeIgnoreFile } from '@eslint/compat';
import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import { fileURLToPath } from 'node:url';
import svelteConfig from './svelte.config.js';

const gitignorePath = fileURLToPath(new URL('./.gitignore', import.meta.url));

// Substituted by Vite's `define` (see vite.config.js), so they exist at build
// time without ever being declared in source.
const buildTimeGlobals = {
	__APP_VERSION__: 'readonly',
	__BUILD_DATE__: 'readonly',
	__APP_BRANCH__: 'readonly',
	__ORBITDB_VERSION__: 'readonly',
	__HELIA_VERSION__: 'readonly',
	__LIBP2P_VERSION__: 'readonly'
};

/** @type {import('eslint').Linter.Config[]} */
export default [
	includeIgnoreFile(gitignorePath),
	js.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.node, ...buildTimeGlobals }
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.js'],
		languageOptions: {
			globals: { ...globals.browser, ...globals.node, ...buildTimeGlobals },
			parserOptions: { svelteConfig }
		}
	}
];
