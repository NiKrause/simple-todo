#!/usr/bin/env node

/**
 * Hybrid Build Script
 * 
 * This script builds both:
 * 1. SSR version for server mode (with Node.js server)
 * 2. Static version for PWA mode (works offline without server)
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

console.log('🎯 Starting Hybrid Build Process...\n');

async function runCommand(command, args, description) {
    console.log(`🔄 ${description}...`);
    
    return new Promise((resolve, reject) => {
        const process = spawn(command, args, {
            stdio: 'inherit',
            shell: true,
            cwd: rootDir
        });
        
        process.on('close', (code) => {
            if (code === 0) {
                console.log(`✅ ${description} completed\n`);
                resolve();
            } else {
                console.error(`❌ ${description} failed with code ${code}\n`);
                reject(new Error(`${description} failed`));
            }
        });
    });
}

async function updateSvelteConfig(adapterType) {
    const configPath = join(rootDir, 'svelte.config.js');
    let content;
    
    if (adapterType === 'node') {
        content = `import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = { 
    kit: { 
        adapter: adapter({
            out: 'build-server',
            precompress: false,
            envPrefix: ''
        }) 
    } 
};

export default config;`;
    } else if (adapterType === 'static') {
        content = `import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = { 
    kit: { 
        adapter: adapter({
            pages: 'build-static',
            assets: 'build-static',
            fallback: 'index.html', // SPA fallback for PWA
            precompress: false,
            strict: false // Allow missing prerendered pages
        }) 
    } 
};

export default config;`;
    }
    
    await fs.writeFile(configPath, content);
    console.log(`📝 Updated svelte.config.js for ${adapterType} adapter`);
}

async function main() {
    try {
        // 1. Build SSR version for server mode
        console.log('🖥️  Building SSR version for server mode...');
        await updateSvelteConfig('node');
        await runCommand('pnpm', ['run', 'build'], 'SSR Build');
        
        // 2. Build static version for PWA mode  
        console.log('📱 Building static version for PWA mode...');
        await updateSvelteConfig('static');
        await runCommand('pnpm', ['run', 'build'], 'Static Build');
        
        // 3. Create deployment instructions
        const instructions = `
🎉 Hybrid Build Complete!

📁 Build Outputs:
├── build-server/     # SSR version (requires Node.js server)
│   ├── index.js      # Server entry point  
│   └── client/       # Client assets
└── build-static/     # PWA version (static files only)
    ├── index.html    # SPA fallback
    ├── sw.js         # Service worker
    └── _app/         # App assets

🚀 Deployment Options:

1️⃣  Server Mode (SSR + OrbitDB server):
   - Deploy build-server/ to Node.js hosting
   - Run: node build-server/index.js
   - Features: SSR, server-side OrbitDB, forms

2️⃣  PWA Mode (Static + client OrbitDB):  
   - Deploy build-static/ to static hosting (CDN, GitHub Pages, etc.)
   - Features: Offline PWA, client-side OrbitDB, P2P

3️⃣  Hybrid Deployment:
   - Use server mode as primary
   - Use static as fallback when server is down
   - PWA automatically switches to client mode

🔧 Docker Commands:
   docker-compose -f docker-compose.hybrid.yml up --build
`;

        console.log(instructions);
        
        // Write instructions to file
        await fs.writeFile(join(rootDir, 'BUILD-INSTRUCTIONS.md'), instructions.trim());
        
        console.log('✅ Hybrid build process completed successfully!');
        console.log('📋 See BUILD-INSTRUCTIONS.md for deployment details');
        
    } catch (error) {
        console.error('❌ Hybrid build failed:', error.message);
        process.exit(1);
    }
}

main();