import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// update version in package.json and title
const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

// Baked as ISO 8601 UTC and formatted in the browser, so the reader sees their
// own locale and clock convention. The previous value glued an ISO *date* to a
// `toLocaleTimeString()` — two different zones in one string, which agreed only
// because CI runs on UTC machines, and rendered midnight as "12:24:19 AM".
const buildDate = new Date().toISOString();
const appBranch = process.env.VITE_APP_BRANCH || process.env.GITHUB_REF_NAME || 'local';

export default defineConfig({
	test: {
		include: ['src/**/*.spec.js'],
		browser: {
			enabled: true,
			headless: true,
			provider: 'playwright',
			instances: [{ browser: 'chromium' }]
		}
	},
	plugins: [
		tailwindcss(),
		sveltekit(),
		nodePolyfills(
			/** @type {any} */ ({
				include: [
					'path',
					'util',
					'buffer',
					'process',
					'events',
					'crypto',
					'os',
					'stream',
					'string_decoder',
					'readable-stream',
					'safe-buffer'
				],
				globals: {
					Buffer: true,
					global: true,
					process: true
				},
				protocolImports: true
			})
		)
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__BUILD_DATE__: JSON.stringify(buildDate),
		__APP_BRANCH__: JSON.stringify(appBranch)
	}
});
