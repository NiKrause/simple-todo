import { test, expect } from '@playwright/test';

test.describe('libp2p WebRTC Transport Test', () => {
  
  test.beforeEach(async ({ page }) => {
    // Enable verbose console logging for debugging
    page.on('console', (msg) => {
      console.log(`Browser console [${msg.type()}]:`, msg.text());
    });

    // Listen for any errors
    page.on('pageerror', (error) => {
      console.error('Page error:', error.message);
    });
  });

  test('should support WebRTC APIs in browser', async ({ page }) => {
    // Navigate to the WebRTC test page
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME 
      ? 'https://simple-todo.le-space.de/webrtc-test.html' 
      : '/webrtc-test.html';
    
    await page.goto(testUrl);
    
    // Wait for the page to load and start initialization
    await expect(page.locator('h1')).toContainText('libp2p WebRTC Connectivity Test');
    
    // Check that WebRTC support is detected
    const webrtcSupportElement = page.locator('#webrtc-support');
    await expect(webrtcSupportElement).toBeVisible({ timeout: 10000 });
    
    // WebRTC should be supported in modern browsers
    await expect(webrtcSupportElement).toContainText('Yes', { timeout: 15000 });
    
    // Verify the WebRTC transport test passes
    const webrtcTransportTest = page.locator('#webrtc-transport-test');
    await expect(webrtcTransportTest).toContainText('WebRTC transport: Supported', { timeout: 15000 });
  });

  test('should initialize WebRTC test successfully', async ({ page }) => {
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME 
      ? 'https://simple-todo.le-space.de/webrtc-test.html' 
      : '/webrtc-test.html';
    
    await page.goto(testUrl);
    
    // Wait for initialization to complete
    const initStatus = page.locator('#init-status');
    await expect(initStatus).toBeVisible();
    
    // Should start with loading status
    await expect(initStatus).toContainText('Initializing libp2p node');
    
    // Should eventually succeed with WebRTC test
    await expect(initStatus).toContainText('WebRTC functionality test completed successfully!', { timeout: 15000 });
    await expect(initStatus).toHaveClass(/success/);
  });

  test('should generate valid peer ID', async ({ page }) => {
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME 
      ? 'https://simple-todo.le-space.de/webrtc-test.html' 
      : '/webrtc-test.html';
    
    await page.goto(testUrl);
    
    // Wait for peer ID generation
    const peerIdElement = page.locator('#peer-id');
    
    // Should not be "Not initialized" after libp2p starts
    await expect(peerIdElement).not.toContainText('Not initialized', { timeout: 45000 });
    
    // Should contain a valid peer ID (base58 encoded, starts with specific characters)
    const peerIdText = await peerIdElement.textContent();
    expect(peerIdText).toBeTruthy();
    expect(peerIdText.length).toBeGreaterThan(10); // Peer IDs are long strings
    
    // Check that peer ID test passed
    const peerIdTest = page.locator('#peer-id-test');
    await expect(peerIdTest).toContainText('Peer ID generation: Success', { timeout: 30000 });
    await expect(peerIdTest).toHaveClass(/success/);
  });

  test('should pass all libp2p WebRTC tests', async ({ page }) => {
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME 
      ? 'https://simple-todo.le-space.de/webrtc-test.html' 
      : '/webrtc-test.html';
    
    await page.goto(testUrl);
    
    // Wait for all tests to complete
    const tests = [
      '#libp2p-init-test',
      '#webrtc-transport-test', 
      '#peer-id-test',
      '#listening-test'
    ];
    
    // Check each test passes
    for (const testSelector of tests) {
      const testElement = page.locator(testSelector);
      await expect(testElement).toBeVisible();
      
      // Should show success status
      await expect(testElement).toHaveClass(/success/, { timeout: 45000 });
      await expect(testElement).toContainText('Success', { timeout: 5000 });
    }
    
    // Overall status should be successful
    const overallStatus = page.locator('#init-status');
    await expect(overallStatus).toHaveClass(/success/);
    await expect(overallStatus).toContainText('WebRTC functionality test completed successfully!');
  });

  test('should display connection log with WebRTC information', async ({ page }) => {
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME 
      ? 'https://simple-todo.le-space.de/webrtc-test.html' 
      : '/webrtc-test.html';
    
    await page.goto(testUrl);
    
    // Wait for log to have content
    const logElement = page.locator('#log');
    await expect(logElement).toBeVisible();
    
    // Should contain initialization messages
    await expect(logElement).toContainText('Starting WebRTC functionality test', { timeout: 10000 });
    await expect(logElement).toContainText('WebRTC Support Check', { timeout: 10000 });
    await expect(logElement).toContainText('RTCPeerConnection: Yes', { timeout: 10000 });
    
    // Should eventually show success messages
    await expect(logElement).toContainText('All WebRTC tests completed successfully!', { timeout: 15000 });
    await expect(logElement).toContainText('WebRTC transport is functional', { timeout: 5000 });
  });

  test('should handle WebRTC connection lifecycle', async ({ page }) => {
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME 
      ? 'https://simple-todo.le-space.de/webrtc-test.html' 
      : '/webrtc-test.html';
    
    await page.goto(testUrl);
    
    // Wait for WebRTC test to complete
    await expect(page.locator('#init-status')).toContainText('WebRTC functionality test completed successfully!', { timeout: 15000 });
    
    // Check that the WebRTC connection is available in the window object
    const connectionExists = await page.evaluate(() => {
      return typeof window.webRTCConnection !== 'undefined';
    });
    
    expect(connectionExists).toBe(true);
    
    // Check connection properties
    const connectionInfo = await page.evaluate(() => {
      if (window.webRTCConnection) {
        return {
          connectionState: window.webRTCConnection.connectionState,
          iceConnectionState: window.webRTCConnection.iceConnectionState,
          hasDataChannel: typeof window.dataChannel !== 'undefined'
        };
      }
      return null;
    });
    
    expect(connectionInfo).toBeTruthy();
    expect(connectionInfo.hasDataChannel).toBe(true);
  });

  test('should work across different browser environments', async ({ page, browserName }) => {
    // Skip Safari on older versions that may not fully support WebRTC
    if (browserName === 'webkit') {
      test.skip(browserName === 'webkit', 'WebRTC support varies in Safari versions');
    }

    const testUrl = process.env.BROWSERSTACK_BUILD_NAME 
      ? 'https://simple-todo.le-space.de/webrtc-test.html' 
      : '/webrtc-test.html';
    
    await page.goto(testUrl);
    
    // Log browser information
    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log(`Testing WebRTC on: ${userAgent}`);
    
    // Basic WebRTC support check should pass
    await expect(page.locator('#webrtc-support')).toContainText('Yes', { timeout: 15000 });
    
    // libp2p should initialize (though some features might vary by browser)
    const initStatus = page.locator('#init-status');
    await expect(initStatus).not.toContainText('Initialization failed', { timeout: 45000 });
  });
});
