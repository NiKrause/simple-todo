/**
 * Where the preview server is, in one place.
 *
 * `playwright.config.js` already honoured `E2E_PREVIEW_PORT`, but two specs
 * carried their own `http://localhost:4173` and so browsed to whatever happened
 * to be on that port — which is the failure #196 was opened for, surviving in
 * the corner that fix did not reach. A spec that hardcodes the port cannot be
 * run beside anything else, and worse, it passes or fails against a build
 * nobody asked it to test.
 */

export const PREVIEW_PORT = Number(process.env.E2E_PREVIEW_PORT || 4173);

export const PREVIEW_ORIGIN = `http://localhost:${PREVIEW_PORT}`;
