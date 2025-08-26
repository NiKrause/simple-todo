import { test, expect } from '@playwright/test';

test.describe('P2P Todo App', () => {
  test('should load app and initialize P2P connection', async ({ page }) => {
    // Navigate to the app - use deployed URL for BrowserStack, baseURL for local
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
    await page.goto(testUrl);
    
    // Check that the main app title is visible
    await expect(page.locator('main h1').filter({ hasText: 'Simple TODO Example' })).toBeVisible();
    
    // Check that the app description is visible
    await expect(page.locator('text=A Basic Local-First Peer-To-Peer PWA')).toBeVisible();
    
    // Wait for P2P initialization - either loading spinner or main content
    const loadingSpinner = page.locator('text=Initializing P2P connection');
    const todoFormContainer = page.locator('h2').filter({ hasText: 'Add New TODO' });
    
    // Check if we see the loading spinner first
    const isLoading = await loadingSpinner.isVisible({ timeout: 5000 });
    
    if (isLoading) {
      console.log('P2P initialization in progress...');
      // Wait for loading to complete (up to 30 seconds for P2P connections)
      await expect(loadingSpinner).not.toBeVisible({ timeout: 30000 });
    }
    
    // After loading, the todo form should be visible
    await expect(todoFormContainer).toBeVisible({ timeout: 10000 });
    await expect(page.locator('input[placeholder="What needs to be done?"]')).toBeVisible({ timeout: 5000 });
  });
  
  test('should show P2P connection status', async ({ page }) => {
    // Navigate to the app
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
    await page.goto(testUrl);
    
    // Wait for app to load (skip loading spinner)
    const loadingSpinner = page.locator('text=Initializing P2P connection');
    const isLoading = await loadingSpinner.isVisible({ timeout: 5000 });
    
    if (isLoading) {
      await expect(loadingSpinner).not.toBeVisible({ timeout: 30000 });
    }
    
    // Check for P2P status indicators - both should be visible
    const connectedPeersSection = page.locator('h2').filter({ hasText: /Connected Peers/ });
    const peerIdSection = page.locator('h2').filter({ hasText: /My Peer ID/ });
    
    // Both sections should be visible
    await expect(connectedPeersSection).toBeVisible({ timeout: 10000 });
    await expect(peerIdSection).toBeVisible({ timeout: 5000 });
    
    // Check if we can find peer ID information (formatted as last 4 characters)
    const peerIdInfo = page.locator('code').filter({ hasText: /^[a-zA-Z0-9]{4}$/ }); // 4-character peer ID display
    await expect(peerIdInfo).toBeVisible({ timeout: 15000 });
  });
  
  test('should allow adding a todo item', async ({ page }) => {
    // Navigate to the app
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
    await page.goto(testUrl);
    
    // Wait for app to load
    const loadingSpinner = page.locator('text=Initializing P2P connection');
    const isLoading = await loadingSpinner.isVisible({ timeout: 5000 });
    
    if (isLoading) {
      await expect(loadingSpinner).not.toBeVisible({ timeout: 30000 });
    }
    
    // Find the todo input field (actual placeholder is "What needs to be done?")
    const todoInput = page.locator('input[placeholder="What needs to be done?"]').first();
    await expect(todoInput).toBeVisible({ timeout: 10000 });
    
    // Add a test todo
    const testTodo = `Test todo - ${Date.now()}`;
    await todoInput.fill(testTodo);
    
    // Submit the todo (actual button text is "Add TODO")
    const submitButton = page.locator('button').filter({ hasText: 'Add TODO' }).first();
    
    if (await submitButton.isVisible()) {
      await submitButton.click();
    } else {
      // If no button, try pressing Enter
      await todoInput.press('Enter');
    }
    
    // Check if todo appears in the list
    const todoItem = page.locator('text=' + testTodo);
    await expect(todoItem).toBeVisible({ timeout: 10000 });
    
    // Look for success message
    const successMessage = page.locator('text=Todo added successfully');
    await expect(successMessage).toBeVisible({ timeout: 5000 });
  });
  
  test('should display existing todos from P2P network', async ({ page }) => {
    // Navigate to the app
    const testUrl = process.env.BROWSERSTACK_BUILD_NAME ? 'https://simple-todo.le-space.de' : '/';
    await page.goto(testUrl);
    
    // Wait for app to load
    const loadingSpinner = page.locator('text=Initializing P2P connection');
    const isLoading = await loadingSpinner.isVisible({ timeout: 5000 });
    
    if (isLoading) {
      await expect(loadingSpinner).not.toBeVisible({ timeout: 30000 });
    }
    
    // Wait a bit more for potential P2P sync
    await page.waitForTimeout(3000);
    
    // Check if any todos are already visible (from P2P sync)
    const todoList = page.locator('div').filter({ hasText: /Delete|Complete|Created by/ });
    const noTodosMessage = page.locator('text=No todos yet');
    
    // Check for either existing todos or "no todos" message
    const hasTodos = await todoList.isVisible({ timeout: 5000 });
    if (!hasTodos) {
      await expect(noTodosMessage).toBeVisible({ timeout: 5000 });
    }
    
    // If there are existing todos, check for P2P metadata
    if (hasTodos) {
      // Look for peer ID information in todos (indicating P2P sync)
      const peerInfo = page.locator('code').filter({ hasText: /^[a-zA-Z0-9]{4}$/ }); // 4-character peer ID display
      await expect(peerInfo).toBeVisible({ timeout: 5000 });
    }
  });
});
