/**
 * Where the preview server is, in one place.
 *
 * `playwright.config.js` and `start-e2e-server.mjs` both honour
 * `E2E_PREVIEW_PORT` since #306, but two specs carried their own
 * `http://localhost:4173` and so browsed to whatever happened to be on that
 * port — the corner that fix did not reach.
 *
 * That is worse than it sounds. With `reuseExistingServer: false` Playwright
 * does not start a second server on an occupied port; it browses to what is
 * already there. A preview left running by another checkout therefore becomes
 * the system under test *silently*, and the suite reports green or red on an
 * app it never built. Only branch-specific assertions fail, so it reads like
 * one flaky test rather than a wrong target — the same five specs once gave
 * 4 passed, then 3 passed, then 5 failed within minutes with no change in
 * between.
 */

export const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT || 4173);

export const PREVIEW_ORIGIN = `http://localhost:${PREVIEW_PORT}`;
