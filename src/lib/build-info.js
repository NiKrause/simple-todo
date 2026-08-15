/**
 * Reporting what this build is made of.
 *
 * The numbers are Vite `define` substitutions (see vite.config.js), fixed when
 * the bundle is built, so nothing here reads a package.json at runtime.
 */

/**
 * The stack the app is built against, one entry per dependency.
 *
 * Read through `typeof` guards because these are build-time substitutions, not
 * imports: anything consuming this module outside a Vite build simply sees no
 * versions.
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
 * read "IPFS + OrbitDB v0.2.0", gluing the app's own version onto the names of
 * two dependencies — so the app is now named alongside them instead of standing
 * in for them.
 *
 * @param {{ appName?: string }} [options] `appName` prefixes the app's own
 *   version; omit it where a heading already names the app.
 * @returns {string} e.g. "Simple-Todo v0.2.0 · OrbitDB 4.0.0 · Helia 7.1.0"
 */
export function formatVersions({ appName = '' } = {}) {
	const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
	const app = appName ? `${appName} v${appVersion}` : `v${appVersion}`;

	return [app, ...stackVersions().map(({ name, version }) => `${name} ${version}`)].join(' · ');
}
