import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

// update version in package.json and title
const file = fileURLToPath(new URL('package.json', import.meta.url));
const json = readFileSync(file, 'utf8');
const pkg = JSON.parse(json);

// Create build date
const buildDate = new Date().toISOString().split('T')[0] + ' ' + new Date().toLocaleTimeString(); // YYYY-MM-DD HH:MM:SS format

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		nodePolyfills({
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
		}),
		VitePWA({
			// PWA configuration optimized for mobile browsers and IndexedDB
			registerType: 'autoUpdate',
			workbox: {
				// Increase the maximum file size limit to 5MB to handle large P2P libraries
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
				// Use network-first strategy to avoid interfering with OrbitDB/libp2p
				runtimeCaching: [
					{
						urlPattern: ({ request }) => {
							// Only cache navigation requests, avoid OrbitDB/IPFS requests
							return (
								request.mode === 'navigate' &&
								!request.url.includes('/ipfs/') &&
								!request.url.includes('/orbitdb/')
							);
						},
						handler: 'NetworkFirst',
						options: {
							cacheName: 'navigation-cache',
							networkTimeoutSeconds: 3,
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						urlPattern: ({ request }) => {
							return request.destination === 'style' || request.destination === 'script';
						},
						handler: 'StaleWhileRevalidate',
						options: {
							cacheName: 'assets-cache'
						}
					}
				],
				// Skip waiting for immediate activation
				skipWaiting: true,
				clientsClaim: true,
				// Exclude OrbitDB and large files from precaching
				globIgnores: ['**/orbitdb/**', '**/ipfs/**', '**/node_modules/**']
			},
			// Use existing manifest.json
			manifest: false, // We'll use our custom manifest.json
			// Development options
			devOptions: {
				enabled: process.env.NODE_ENV === 'development',
				type: 'module'
			},
			// Enable periodic SW updates
			periodicSyncForUpdates: 20
		})
	],
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__BUILD_DATE__: JSON.stringify(buildDate)
	}
});
