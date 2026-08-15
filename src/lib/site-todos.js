/**
 * The chapter's worked example: a site manager's list, in work order.
 *
 * Deliberately free of imports. `site-list.js` needs the app — OrbitDB, stores,
 * the libp2p config — and importing that from a Playwright spec drags
 * `import.meta.env` into the Node test runner, where it is undefined. That does
 * not merely break the importing spec: collection fails and the *entire* suite
 * reports zero tests. Keeping the data on its own means the E2E can assert
 * against the same ten strings the app writes, with nothing else attached.
 */
export const SITE_TODOS = [
	'Set out the pit and mark the boundaries',
	'Strip and stockpile the topsoil',
	'Excavate to formation level',
	'Level and compact the base',
	'Pour the blinding layer',
	'Erect the formwork for the base slab',
	'Place and tie the reinforcement',
	'Pour and cure the base slab',
	'Apply the tanking and waterproofing',
	'Backfill and lay the perimeter drainage'
];
