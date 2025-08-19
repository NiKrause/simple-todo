#!/usr/bin/env node
/**
 * BrowserStack Local tunnel management script
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import browserstack from 'browserstack-local';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class BrowserStackLocal {
  constructor() {
    this.bs_local = new browserstack.Local();
    this.isConnected = false;
  }

  async start() {
    return new Promise((resolve, reject) => {
      if (!process.env.BROWSERSTACK_ACCESS_KEY) {
        reject(new Error('BROWSERSTACK_ACCESS_KEY environment variable is required'));
        return;
      }

      console.log('🚀 Starting BrowserStack Local tunnel...');

      const options = {
        key: process.env.BROWSERSTACK_ACCESS_KEY,
        verbose: true,
        force: true,
        onlyAutomate: true,
        forceLocal: true
      };

      this.bs_local.start(options, (error) => {
        if (error) {
          console.error('❌ Error starting BrowserStack Local:', error);
          reject(error);
          return;
        }

        this.isConnected = true;
        console.log('✅ BrowserStack Local tunnel started successfully');
        console.log('🔗 Local testing environment is now accessible via BrowserStack');
        resolve();
      });
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        console.log('ℹ️ BrowserStack Local tunnel is not running');
        resolve();
        return;
      }

      console.log('🛑 Stopping BrowserStack Local tunnel...');
      
      this.bs_local.stop((error) => {
        if (error) {
          console.error('❌ Error stopping BrowserStack Local:', error);
          reject(error);
          return;
        }

        this.isConnected = false;
        console.log('✅ BrowserStack Local tunnel stopped successfully');
        resolve();
      });
    });
  }

  async isRunning() {
    return this.bs_local.isRunning();
  }
}

// CLI handling
const action = process.argv[2];

if (action === 'start') {
  const bsLocal = new BrowserStackLocal();
  
  bsLocal.start().catch((error) => {
    console.error('Failed to start BrowserStack Local:', error);
    process.exit(1);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🔄 Received SIGINT, shutting down gracefully...');
    try {
      await bsLocal.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n🔄 Received SIGTERM, shutting down gracefully...');
    try {
      await bsLocal.stop();
      process.exit(0);
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
} else if (action === 'stop') {
  const bsLocal = new BrowserStackLocal();
  bsLocal.stop().catch((error) => {
    console.error('Failed to stop BrowserStack Local:', error);
    process.exit(1);
  });
} else {
  console.log('Usage: node browserstack-local.js [start|stop]');
  process.exit(1);
}

export default BrowserStackLocal;
