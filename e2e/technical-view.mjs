import { TECHNICAL_VIEW_STORAGE_KEY } from '../src/lib/technical-view.js';

/**
 * Pin the technical view before the page runs.
 *
 * The app opens in the simple view, and that view does not render the network
 * details (peer count, manual relay connect, connected peers, own multiaddrs),
 * the start's individual steps, or the relay button. Specs that read those need
 * the view they live in. Written to storage rather than clicked, so the first
 * render is already the right one, and nothing waits for a header that the
 * consent dialog still covers.
 *
 * Ported from qr01's `pinTechnicalView` (`e2e/open-app.mjs`). The key comes from
 * the store itself: a literal here would drift silently if that one changed.
 *
 * It does not touch the consent dialog's flow. The dialog reads the same
 * setting, so it opens with its technical view on, and `consent.mjs` walks it
 * the same way either way.
 *
 * @param {import('@playwright/test').Page | import('@playwright/test').BrowserContext} target
 *   a page, or a whole context when every page in it needs the view
 */
export async function pinTechnicalView(target) {
	await target.addInitScript(
		([key, value]) => {
			try {
				localStorage.setItem(key, value);
			} catch {
				// Storage blocked: the app stays in the simple view, and whichever
				// assertion needed a technical-view element fails there, naming that
				// element rather than naming storage.
			}
		},
		[TECHNICAL_VIEW_STORAGE_KEY, 'true']
	);
}
