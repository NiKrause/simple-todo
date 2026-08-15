/**
 * Keep the screen awake while a code is on screen or the camera is open.
 *
 * Both halves of the handover are a person holding a phone still and *not*
 * touching it: one holds up an animated code for a camera, the other points a
 * camera at it. That is exactly the situation a phone reads as idle, and a
 * screen that dims mid-sequence ruins a scan — an animated code needs several
 * frames, so going dark halfway is worse than never starting.
 *
 * Ported from the webrtc-qr demo's `wakelock.js`, including the two details
 * that are easy to miss:
 *
 *   - the browser releases the lock whenever the page stops being visible, so
 *     it has to be re-acquired on the way back rather than assumed to persist;
 *   - `request()` can resolve *after* the page has gone away again, which would
 *     otherwise leave a lock nobody wanted.
 *
 * It does not cover someone deliberately locking their phone, and does not
 * pretend to.
 */

/** @type {any} */
let lock = null;
let wanted = false;
let listening = false;

/**
 * `wanted` is our decision; `held` is the browser's answer to it. Reported
 * separately because only the first is ours to get right — a headless browser
 * exposes the API and then refuses every request, having no screen to keep
 * awake, so asserting on `held` would be asserting on the platform.
 */
export function wakeLockState() {
	return {
		supported: typeof navigator !== 'undefined' && 'wakeLock' in navigator,
		wanted,
		held: lock != null
	};
}

/** @param {boolean} active */
export async function syncWakeLock(active) {
	wanted = active;

	if (typeof document !== 'undefined' && !listening) {
		listening = true;
		document.addEventListener('visibilitychange', () => {
			void syncWakeLock(wanted);
		});
	}

	if (!wanted || (typeof document !== 'undefined' && document.visibilityState !== 'visible')) {
		await releaseWakeLock();
		return;
	}

	await acquire();
}

async function acquire() {
	if (!wakeLockState().supported || lock != null) return;

	try {
		const held = await /** @type {any} */ (navigator).wakeLock.request('screen');

		if (!wanted || document.visibilityState !== 'visible') {
			await held.release().catch(() => {});
			return;
		}

		held.addEventListener('release', () => {
			if (lock === held) lock = null;
		});

		lock = held;
	} catch {
		// Denied, unsupported in this context, or the document was not visible
		// after all. Nothing here is worth interrupting anybody over.
	}
}

export async function releaseWakeLock() {
	const held = lock;
	lock = null;
	if (held != null) await held.release().catch(() => {});
}
