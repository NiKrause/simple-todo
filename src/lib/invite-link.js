/**
 * Handing over an invite as a link instead of a code held up to a camera.
 *
 * Ported from `main`, unchanged in substance, because this chapter needs the
 * same thing for a different reason. There, a link is a convenience next to the
 * code. Here it is the second half of the handover: the roundtrip is
 * offer → answer → back, and a phone that can scan a code cannot always show
 * one back — a cracked screen in the sun, a camera the other side does not
 * have, two people who are not in the same room after all.
 *
 * The payload rides in the URL **fragment**, never the query string. A fragment
 * is not sent to the server, and this app is served from `qr01.le-space.de` and
 * from public IPFS gateways alike — putting a signed connection offer in the
 * query would hand it to every gateway operator and into their access logs, for
 * no benefit. The receiving page reads it locally and nothing else ever sees it.
 *
 * That matters more here than on `main`: this chapter's whole claim is that the
 * list travels between two people and touches nothing in between.
 */
const FRAGMENT_KEY = 'invite';

/**
 * @param {string} payload
 * @param {string} [href] defaults to the current location
 * @returns {string}
 */
export function buildInviteLink(
	payload,
	href = typeof location === 'undefined' ? '' : location.href
) {
	const url = new URL(href);

	// A link built from a page that already carries an invite must not stack a
	// second one, and query parameters like `?ice=stun` stay untouched — they
	// describe the mode the receiver should open in, and dropping them would
	// send someone on a different network back to host-only candidates.
	url.hash = `${FRAGMENT_KEY}=${encodeURIComponent(payload)}`;

	return url.toString();
}

/**
 * The invite carried by a URL, or null when there is none.
 *
 * @param {string} [href] defaults to the current location
 * @returns {string | null}
 */
export function readInviteLink(href = typeof location === 'undefined' ? '' : location.href) {
	if (!href) {
		return null;
	}

	let hash;
	try {
		hash = new URL(href).hash;
	} catch {
		return null;
	}

	const params = new URLSearchParams(hash.replace(/^#/u, ''));
	const payload = params.get(FRAGMENT_KEY);

	return payload && payload.trim().length > 0 ? payload : null;
}

/**
 * Drop the invite from the address bar once it has been consumed.
 *
 * Without this a reload would replay a spent offer, and the payload would sit in
 * the browser's history and in whatever the user copies out of the address bar
 * next. `replaceState` rather than assigning `location.hash`, which would push a
 * history entry and fire a navigation.
 */
export function clearInviteLink() {
	if (typeof window === 'undefined' || typeof history === 'undefined') {
		return;
	}

	try {
		history.replaceState(null, '', `${location.pathname}${location.search}`);
	} catch {
		// Sandboxed frames can refuse history access; a stale fragment is a far
		// smaller problem than failing to connect.
	}
}
