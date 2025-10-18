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
				// 'path', // Exclude path to prevent service worker conflicts
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
			// PWA configuration for hybrid offline/online functionality
			registerType: 'autoUpdate',
			injectRegister: 'script', // Force script injection
			strategies: 'generateSW', // Generate service worker
			workbox: {
				// Increase the maximum file size limit to 5MB to handle large P2P libraries
				maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5MB
				// Aggressive caching for offline-first PWA functionality
				runtimeCaching: [
					{
						// Cache all navigation requests for offline PWA
							urlPattern: ({ request, url }) => {
								return (
									request.mode === 'navigate' ||
									(request.method === 'GET' && request.headers.get('accept')?.includes('text/html'))
								);
							},
							handler: 'NetworkFirst', // Required when using networkTimeoutSeconds
							options: {
								cacheName: 'navigation-cache',
								networkTimeoutSeconds: 3, // Quick timeout for offline fallback
								cacheableResponse: {
									statuses: [0, 200]
								}
							}
					},
					{
						// Cache form actions for offline submission handling
						urlPattern: /\?\/(addTodo|toggleTodo|deleteTodo)$/,
						handler: 'NetworkFirst', // Required for networkTimeoutSeconds
						options: {
							cacheName: 'form-actions-cache',
							networkTimeoutSeconds: 2
						}
					},
					{
						// Cache static assets (CSS, JS, images)
						urlPattern: ({ request }) => {
							return (
								request.destination === 'style' ||
								request.destination === 'script' ||
								request.destination === 'image' ||
								request.destination === 'font'
							);
						},
						handler: 'CacheFirst', // Static assets rarely change
						options: {
							cacheName: 'assets-cache',
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					}
				],
				// Skip waiting for immediate activation (critical for PWA updates)
				skipWaiting: true,
				clientsClaim: true,
				// More aggressive precaching for offline functionality
				navigationPreload: true,
				// Critical: Include offline fallback page
				navigateFallback: '/offline-fallback.html',
				// Exclude OrbitDB and large files from precaching
				globIgnores: ['**/orbitdb/**', '**/ipfs/**', '**/node_modules/**'],
				// Include all built assets for offline use
				globPatterns: [
					'**/*.{js,css,html,ico,png,svg,webmanifest}'
				]
			},
			// Generate manifest.json automatically with better PWA support
			manifest: {
				name: 'Simple TODO - Hybrid P2P App',
				short_name: 'P2P Todo',
				description: 'A hybrid local-first peer-to-peer TODO list app',
				theme_color: '#3B82F6',
				background_color: '#ffffff',
				display: 'standalone',
				start_url: '/',
				scope: '/',
				orientation: 'any',
				categories: ['productivity', 'utilities'],
				icons: [
					{
						src: '/android-chrome-192x192.png',
						sizes: '192x192',
						type: 'image/png'
					},
					{
						src: '/android-chrome-512x512.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'any maskable'
					}
			]
			},
			// Development options
			devOptions: {
				enabled: true,
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
