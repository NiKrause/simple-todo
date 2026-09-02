/**
 * What this chapter is built from — the structure, without the prose.
 *
 * The prose lives in `i18n/*.json` under `intro.chapter.parts.<key>` because it
 * is translated; the package names live here because they are not. Keeping them
 * apart is what lets one list feed two places: the intro dialog renders it in
 * whichever language is on, and `scripts/sync-chapter-readme.mjs` renders the
 * same list into the README with versions resolved from `package.json`.
 *
 * That is the point of the file. A chapter that explains itself in a modal and
 * again in a README will otherwise explain itself differently within a month,
 * and the version numbers in the README will be the first thing to go stale.
 *
 * `packages` is a list because one part can be assembled from several — storage
 * is Helia plus two IndexedDB adapters, and naming only one of them would send
 * a reader looking in the wrong place.
 */

/**
 * @typedef {object} ChapterPart
 * @property {string} key matches `intro.chapter.parts.<key>` in the translations
 * @property {string[]} packages npm names, resolved to versions for the README
 * @property {string} [protocol] for the one part that is ours rather than a dependency
 * @property {boolean} [unused] shipped with something else and deliberately not switched on
 */

/** @type {ChapterPart[]} */
export const CHAPTER_PARTS = [
	{ key: 'connection', packages: ['@le-space/libp2p-webrtc-qr'] },
	{ key: 'identity', packages: ['@le-space/orbitdb-identity-provider-webauthn-did'] },
	// Not a direct dependency: it arrives with the identity provider and nothing
	// in `src/` imports it. Listed anyway, because a reader who finds it in the
	// lockfile deserves to know why it is there and why it is quiet.
	{ key: 'varsig', packages: ['@le-space/iso-webauthn-varsig'], unused: true },
	{ key: 'permissions', packages: ['@orbitdb/core'] },
	{ key: 'database', packages: ['@orbitdb/core'] },
	{ key: 'storage', packages: ['helia', 'blockstore-idb', 'datastore-idb'] },
	{ key: 'protocol', packages: [], protocol: '/simple-todo/qr01/1.0.0' },
	{ key: 'relay', packages: ['@le-space/aleph-bootstrap'] }
];
