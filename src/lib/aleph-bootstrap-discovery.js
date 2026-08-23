import { discoverAlephBootstrapMultiaddrs } from '@le-space/aleph-bootstrap';

// The relay registrations live on a public Aleph channel: anyone with an ETH
// key can post there, and registrations of erased VMs are orphaned forever
// (guests self-publish with generated keys since relay-button #66, so no
// remaining key can FORGET them). Discovery therefore scopes hard before any
// dial probe runs (issue #84):
//  - registrationId: only the app's own production registration — ephemeral
//    E2E relays register as `relay:<profile>:simple-todo-e2e-*` and polluted
//    the candidate list until the browser's probe wave exhausted its stream
//    budget and dropped the healthy relay along with the corpses.
//  - maxAgeMs: orphans stop refreshing (live relays republish every 6 h), so
//    anything older than ~2 cadences is dead weight even when the
//    registrationId matches.
//
// Both scopes are the package's own since @le-space/aleph-bootstrap 0.9.4
// (relay-button#121). This file used to rebuild that pipeline out of the
// primitives — paging, freshness, profile, address selection, dedupe — for the
// sake of the one filter the package lacked. It no longer lacks it.
const DEFAULT_REGISTRATION_ID = 'relay:orbitdb-relay:orbitdb-relay';
const DEFAULT_MAX_AGE_MS = 13 * 60 * 60 * 1000;

/**
 * @param {{ profile?: string, registrationId?: string, maxAgeMs?: number, pagination?: number }} [options]
 * @returns {Promise<string[]>}
 */
export async function discoverScopedBootstrapMultiaddrs({
	profile = 'orbitdb-relay',
	registrationId = DEFAULT_REGISTRATION_ID,
	maxAgeMs = DEFAULT_MAX_AGE_MS,
	pagination = 100
} = {}) {
	return await discoverAlephBootstrapMultiaddrs({
		profile,
		registrationId,
		maxAgeMs,
		pagination,
		// The callers filter again for what *this* browser can dial — an https
		// page refuses a plaintext `/ws` as mixed content — so this is the coarse
		// pass, not the only one.
		browserDialableOnly: true
	});
}
