/**
 * Nobody writes the preview port down by hand again.
 *
 * #306 taught `playwright.config.js` and `start-e2e-server.mjs` to honour
 * `E2E_PREVIEW_PORT`, and two specs kept their own `http://localhost:4173`
 * anyway. That is not a tidiness problem. With `reuseExistingServer: false`
 * Playwright does not start a second server on an occupied port - it browses to
 * whatever is already there, so a preview left running by another checkout
 * becomes the system under test in silence and the suite reports on an app it
 * never built.
 *
 * The failure is expensive precisely because it does not look like one: only
 * branch-specific assertions fail, which reads as a single flaky test. The same
 * five specs once gave 4 passed, then 3 passed, then 5 failed within minutes
 * with no change in between.
 *
 * So this is a guard rather than a test: static, instant, and it fails with the
 * sentence somebody needs rather than with a diff.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(e2eDir, '..');

/**
 * The three places a port literal is the answer rather than the bug.
 *
 * Each reads `E2E_PREVIEW_PORT` and falls back - which is what a default is.
 * Everything else should be asking one of them.
 */
const MAY_SAY_A_PORT = new Set([
	'e2e/preview-origin.mjs',
	'e2e/start-e2e-server.mjs',
	'playwright.config.js',
	// This file, which has to name the port twice to prove the env reaches it.
	'e2e/check-preview-origin.mjs'
]);

/**
 * Vite's preview default, written any of the ways - and only that.
 *
 * A first draft flagged every `localhost:<port>` and immediately reported
 * `e2e/remote/aleph-guest-proxy.mjs` for naming port 3000, which is a different
 * service and none of this guard's business. 4173 is the number two checkouts
 * collide on, because it is the one vite picks when nobody says otherwise.
 */
const HARDCODED = /(?:localhost|127\.0\.0\.1|\[::1\]):4173/g;

async function* sourceFiles (dir) {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

		const full = join(dir, entry.name);

		if (entry.isDirectory()) yield* sourceFiles(full);
		else if (/\.(m?js|ts)$/.test(entry.name)) yield full;
	}
}

const found = [];

for await (const file of sourceFiles(e2eDir)) {
	const name = relative(rootDir, file);

	if (MAY_SAY_A_PORT.has(name)) continue;

	const text = await readFile(file, 'utf8');

	for (const [index, line] of text.split('\n').entries()) {
		// A line that is only a comment is describing the problem, not causing
		// it - this file and several others would otherwise report themselves.
		if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;

		for (const hit of line.match(HARDCODED) ?? []) {
			found.push(`${name}:${index + 1}  ${hit}`);
		}
	}
}

// The env has to reach the origin, which is the other half of the same
// promise: a spec that imports this and a run that sets the variable must
// agree, or the guard above is checking spelling rather than behaviour.
process.env.E2E_PREVIEW_PORT = '4271';

const { PREVIEW_ORIGIN } = await import(`./preview-origin.mjs?probe=${Date.now()}`);

if (PREVIEW_ORIGIN !== 'http://localhost:4271') {
	console.error(
		`❌ preview-origin.mjs ignored E2E_PREVIEW_PORT: expected http://localhost:4271, got ${PREVIEW_ORIGIN}`
	);
	process.exit(1);
}

if (found.length > 0) {
	console.error(
		'❌ A preview origin is written down by hand:\n\n' +
			found.map(f => `   ${f}`).join('\n') +
			'\n\n   Import PREVIEW_ORIGIN from ./preview-origin.mjs instead.\n' +
			'   A hardcoded port makes the spec browse to whatever is already on it,\n' +
			'   so it can pass or fail against a build nobody asked it to test.\n'
	);
	process.exit(1);
}

console.log(`✅ Every preview origin comes from E2E_PREVIEW_PORT (probed: ${PREVIEW_ORIGIN}).`);
