/**
 * Rendering the baked build timestamp for a reader.
 *
 * `__BUILD_DATE__` is an ISO 8601 UTC string, so the moment is unambiguous no
 * matter where the build ran. Turning it into text is left until here, in the
 * browser, because only the browser knows the reader's locale and whether they
 * expect a 12- or 24-hour clock.
 */

/**
 * @param {string} [iso] the baked ISO timestamp
 * @param {string | string[]} [locales] defaults to the browser's own
 * @returns {string}
 */
export function formatBuildDate(iso, locales = undefined) {
	if (typeof iso !== 'string' || iso.length === 0) {
		return 'dev';
	}

	const parsed = new Date(iso);

	// Anything unparseable is shown as-is rather than swallowed: a build stamped
	// by an older toolchain is still more useful on screen than "Invalid Date",
	// and silently blanking it would hide which build someone is looking at.
	if (Number.isNaN(parsed.getTime())) {
		return iso;
	}

	return parsed.toLocaleString(locales, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
}

/**
 * The stack the app is built against, newest-baked value per dependency.
 *
 * Read through `typeof` guards because these are Vite `define` substitutions,
 * not imports: anything consuming this module outside a Vite build (a Node
 * script, another app importing `ConsentModal.svelte`) simply sees no versions.
 *
 * @returns {{ name: string, version: string }[]} only dependencies whose
 *   version was actually baked in — a name with no number is left out rather
 *   than shown with a placeholder that would be another wrong version on screen.
 */
function stackVersions() {
	const baked = [
		['OrbitDB', typeof __ORBITDB_VERSION__ !== 'undefined' ? __ORBITDB_VERSION__ : null],
		['Helia', typeof __HELIA_VERSION__ !== 'undefined' ? __HELIA_VERSION__ : null],
		['libp2p', typeof __LIBP2P_VERSION__ !== 'undefined' ? __LIBP2P_VERSION__ : null]
	];

	return baked
		.filter(([, version]) => typeof version === 'string' && version.length > 0)
		.map(([name, version]) => ({ name: String(name), version: String(version) }));
}

/**
 * The versions line shown in the header and on the consent screen.
 *
 * Every number is preceded by the thing it belongs to. The line this replaces
 * read "IPFS + OrbitDB v0.3.1", gluing the app's own version onto the names of
 * two dependencies — so the app is now named alongside them instead of standing
 * in for them.
 *
 * @param {{ appName?: string }} [options] `appName` prefixes the app's own
 *   version; omit it where a heading already names the app.
 * @returns {string} e.g. "Simple-Todo v0.3.1 · OrbitDB 4.0.0 · Helia 7.1.0"
 */
export function formatVersions({ appName = '' } = {}) {
	const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
	const app = appName ? `${appName} v${appVersion}` : `v${appVersion}`;

	return [app, ...stackVersions().map(({ name, version }) => `${name} ${version}`)].join(' · ');
}

/**
 * The commit a bundle was built from, shortened to what a person compares.
 *
 * Seven characters is what `git log --oneline` prints, so the value can be
 * matched against the repository by eye. Returns an empty string when the
 * build had no commit to record — a local `vite dev` outside a checkout —
 * and the caller then leaves it out rather than showing a placeholder that
 * looks like a real answer.
 *
 * @param {string} sha
 * @returns {string}
 */
export function formatCommitSha(sha) {
	const trimmed = String(sha ?? '').trim();
	if (!/^[0-9a-f]{7,40}$/i.test(trimmed)) return '';
	return trimmed.slice(0, 7).toLowerCase();
}
