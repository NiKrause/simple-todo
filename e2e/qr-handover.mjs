import { expect } from '@playwright/test';
import { openListTab } from './open-app.mjs';

/**
 * The QR roundtrip, shared by every spec that needs two browsers introduced to
 * each other. A copy per spec would drift: this drives `window.__simpleTodoQr`,
 * which is the seam the scanner writes into, and the payload types have to
 * match what the transport emits.
 *
 * The camera is the one thing a headless browser cannot supply. Everything
 * after the payload arrives is the same code the scanner drives — the two paths
 * differ in where the text came from and nowhere else.
 */
const QR_TYPE_OFFER = 'offer';
const QR_TYPE_ANSWER = 'answer';

/**
 * Alice offers, Bob answers, Alice accepts the answer.
 *
 * @param {import('@playwright/test').Page} alice
 * @param {import('@playwright/test').Page} bob
 * @param {{ timeout?: number }} [options]
 */
export async function handshake(alice, bob, { timeout = 90_000 } = {}) {
	// Seeding a list leaves them on the "make a list" tab, and the transfer
	// controls are hidden while another tab is showing. Put them back where the
	// app itself opens before driving the handover.
	await openListTab(alice, 'transfer');
	await openListTab(bob, 'transfer');
	await alice.getByTestId('qr-transfer-start').click();

	const offer = await alice.waitForFunction(
		() => window.__simpleTodoQr?.offerPayload?.() || null,
		undefined,
		{ timeout }
	);
	const offerText = await offer.jsonValue();

	const answerText = await bob.evaluate(
		async ([text, type]) => {
			await window.__simpleTodoQr.useScannedPayload(text, type);
			return window.__simpleTodoQr.offerPayload();
		},
		[offerText, QR_TYPE_OFFER]
	);
	expect(answerText).toBeTruthy();

	await alice.evaluate(
		async ([text, type]) => window.__simpleTodoQr.useScannedPayload(text, type),
		[answerText, QR_TYPE_ANSWER]
	);

	await expect(alice.getByTestId('qr-transfer-connected')).toBeVisible({ timeout });
}

/**
 * A virtual authenticator, so a spec can create and use a passkey.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function addVirtualAuthenticator(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasLargeBlob: true,
			automaticPresenceSimulation: true
		}
	});
}
