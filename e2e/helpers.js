import { expect } from '@playwright/test';

/**
 * Helper to accept consent modal and initialize P2P
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {Object} [options] - Options for consent
 * @param {boolean} [options.enableNetworkConnection=true] - Enable network connection
 * @param {boolean} [options.enablePeerConnections=true] - Enable peer connections
 */
export async function acceptConsentAndInitialize(page, options = {}) {
	const { enableNetworkConnection = true, enablePeerConnections = true } = options;

	// Wait for consent modal to appear
	await page.waitForSelector('[data-testid="consent-modal"]', {
		state: 'attached',
		timeout: 20000
	});

	// Scroll to bottom to ensure modal is in viewport
	await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

	// Verify it's visible
	await expect(page.locator('[data-testid="consent-modal"]')).toBeVisible({ timeout: 5000 });

	// Toggle network connection if needed
	if (!enableNetworkConnection) {
		const consentModal = page.locator('[data-testid="consent-modal"]');
		const toggleButtons = consentModal.locator('button.relative.inline-flex');
		await toggleButtons.nth(1).click(); // Second toggle is Network
	}

	// Toggle peer connections if needed (only if network is enabled)
	if (!enablePeerConnections && enableNetworkConnection) {
		const consentModal = page.locator('[data-testid="consent-modal"]');
		// Find the peer connections checkbox (third toggle)
		const peerCheckbox = consentModal.locator('#peer-connections');
		if (await peerCheckbox.isVisible()) {
			const isChecked = await peerCheckbox.isChecked();
			if (isChecked) {
				await peerCheckbox.click();
			}
		}
	}

	// Click Accept & Continue button
	const consentModal = page.locator('[data-testid="consent-modal"]');
	const proceedButton = consentModal.getByRole('button', { name: 'Accept & Continue' });
	await expect(proceedButton).toBeVisible({ timeout: 10000 });
	await expect(proceedButton).toBeEnabled({ timeout: 5000 });
	await proceedButton.click();

	// Wait for modal to disappear
	await expect(page.locator('[data-testid="consent-modal"]')).not.toBeVisible();

	console.log('✅ Consent accepted and P2P initialization started');
}

/**
 * Helper to wait for P2P initialization to complete
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout=30000] - Timeout in milliseconds
 */
export async function waitForP2PInitialization(page, timeout = 30000) {
	console.log('⏳ Waiting for P2P initialization...');

	// Wait for peer ID to be displayed (indicates successful P2P initialization)
	await page.waitForSelector('[data-testid="peer-id"]', { timeout });

	// Wait for todo input to be available (indicates OrbitDB is ready)
	await page.waitForSelector('[data-testid="todo-input"]', { timeout: 10000 });

	console.log('✅ P2P initialization completed');
}

/**
 * Helper to wait for peer connection count to reach a minimum
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} minPeers - Minimum number of peers to wait for
 * @param {number} [timeout=60000] - Timeout in milliseconds
 */
export async function waitForPeerCount(page, minPeers = 1, timeout = 60000) {
	console.log(`⏳ Waiting for at least ${minPeers} peer(s)...`);

	await page.waitForFunction(
		(min) => {
			// Look for the Connected Peers section
			const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
				h.textContent?.includes('Connected Peers')
			);
			if (!heading) return false;

			// Extract count from heading text like "Connected Peers (2)"
			const match = heading.textContent?.match(/\((\d+)\)/);
			const count = match ? parseInt(match[1], 10) : 0;

			return count >= min;
		},
		minPeers,
		{ timeout }
	);

	console.log(`✅ Peer count reached at least ${minPeers}`);
}

/**
 * Helper to get the current peer count
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<number>} Current peer count
 */
export async function getPeerCount(page) {
	return await page.evaluate(() => {
		const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
			h.textContent?.includes('Connected Peers')
		);
		if (!heading) return 0;

		const match = heading.textContent?.match(/\((\d+)\)/);
		return match ? parseInt(match[1], 10) : 0;
	});
}

/**
 * Helper to get the peer ID of the current page
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<string|null>} Peer ID or null if not found
 */
export async function getPeerId(page) {
	return await page.evaluate(() => {
		const peerIdElement = document.querySelector('[data-testid="peer-id"]');
		return peerIdElement?.textContent?.trim() || null;
	});
}

/**
 * Helper to get list of connected peer IDs
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @returns {Promise<string[]>} Array of peer IDs
 */
export async function getConnectedPeerIds(page) {
	return await page.evaluate(() => {
		const peers = [];
		// Find the Connected Peers section
		const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
			h.textContent?.includes('Connected Peers')
		);
		if (!heading) return peers;

		// Find the parent container
		const container = heading.closest('.rounded-lg');
		if (!container) return peers;

		// Find all peer ID code elements
		const peerElements = container.querySelectorAll('code');
		peerElements.forEach((el) => {
			const text = el.textContent?.trim();
			if (text && text.length > 0) {
				peers.push(text);
			}
		});

		return peers;
	});
}

/**
 * Helper to wait for a specific peer to appear in the connected peers list
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {string} peerId - Peer ID to wait for (can be partial match)
 * @param {number} [timeout=30000] - Timeout in milliseconds
 */
export async function waitForPeerInList(page, peerId, timeout = 30000) {
	console.log(`⏳ Waiting for peer ${peerId} to appear in connected peers list...`);

	await page.waitForFunction(
		(expectedPeerId) => {
			const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
				h.textContent?.includes('Connected Peers')
			);
			if (!heading) return false;

			const container = heading.closest('.rounded-lg');
			if (!container) return false;

			const peerElements = container.querySelectorAll('code');
			for (const el of peerElements) {
				const text = el.textContent?.trim();
				if (text && text.includes(expectedPeerId)) {
					return true;
				}
			}
			return false;
		},
		peerId,
		{ timeout }
	);

	console.log(`✅ Peer ${peerId} found in connected peers list`);
}

/**
 * Helper to wait for WebRTC connection (checks for transport badges)
 *
 * @param {import('@playwright/test').Page} page - Playwright page instance
 * @param {number} [timeout=60000] - Timeout in milliseconds
 */
export async function waitForWebRTCConnection(page, timeout = 60000) {
	console.log('⏳ Waiting for WebRTC connection...');

	// Wait for any transport badge to appear (indicating connection)
	await page.waitForFunction(
		() => {
			// Look for transport badges in the Connected Peers section
			const heading = Array.from(document.querySelectorAll('h2')).find((h) =>
				h.textContent?.includes('Connected Peers')
			);
			if (!heading) return false;

			const container = heading.closest('.rounded-lg');
			if (!container) return false;

			// Look for transport badges (webrtc, websocket, etc.)
			const badges = container.querySelectorAll('[class*="badge"], [class*="transport"]');
			return badges.length > 0;
		},
		{ timeout }
	);

	console.log('✅ WebRTC connection established');
}
