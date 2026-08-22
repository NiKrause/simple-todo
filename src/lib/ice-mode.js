/**
 * ICE configuration, defaulting to host candidates only.
 *
 * The other chapters always configure STUN servers. This one inverts that,
 * because of when its QR code can be drawn.
 *
 * A payload carried by a human cannot trickle: the whole candidate set has to
 * be in the SDP before it can be rendered. `@le-space/libp2p-webrtc-qr`
 * therefore awaits gathering before producing either the offer or the answer
 * (`src/session.js`), with `iceGatheringTimeout` defaulting to 15 s. With STUN
 * servers configured but unreachable — a hotspot on a construction site, which
 * is the entire premise here — gathering does not complete until those
 * transactions give up, so the person holding the phone waits up to 15 s for a
 * code to appear, and the other side waits again for the answer.
 *
 * Host candidates need no server at all. They are gathered locally from the
 * network interfaces, and two devices on the same hotspot can reach each other
 * with nothing else — which is why this works offline in the first place, and
 * why STUN is the exception rather than the default.
 *
 * `?ice=stun` turns them back on for the case the chapter does not cover: two
 * devices that are *not* on the same network.
 */

const ICE_MODE_KEY = 'qr01.iceMode';

const DEFAULT_STUN_SERVERS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

/**
 * The ICE mode for this session.
 *
 * Remembered rather than re-read per navigation: the app routes on the client,
 * so requiring `?ice=` on every URL would let a single in-app navigation
 * silently change the transport behaviour underneath the user.
 *
 * @returns {string | null}
 */
export function iceMode() {
	if (typeof location === 'undefined') return null;

	const fromUrl = new URLSearchParams(location.search).get('ice');

	try {
		if (fromUrl) {
			sessionStorage.setItem(ICE_MODE_KEY, fromUrl);
			return fromUrl;
		}
		return sessionStorage.getItem(ICE_MODE_KEY);
	} catch {
		// Storage blocked — honour whatever this URL says.
		return fromUrl;
	}
}

/**
 * @returns {{ iceServers: Array<{ urls: string[] }> }}
 */
/**
 * A configuration for *diagnosing* the network, which is not the same job as
 * carrying traffic.
 *
 * The transport defaults to host candidates only, and that is right: this
 * chapter hands a list to somebody standing next to you. But a diagnosis built
 * on host candidates can only ever report "I have a LAN address", which every
 * device always has — it cannot tell a working network from a hopeless one.
 * Only a reflexive candidate, bounced off a STUN server, is evidence that
 * anything outside this network can be reached.
 *
 * So the probe always uses STUN, whatever the transport is set to, and the
 * verdict is phrased as a statement about the *network* rather than about what
 * the app will do with it.
 *
 * One entry per URL rather than one entry listing them all. Both are valid
 * WebRTC and behave the same for credential-less STUN, but this is the shape
 * `probeNetwork` is typed for - its parameter type is inferred from the
 * package's own default, which spells a single string.
 *
 * @returns {{ iceServers: Array<{ urls: string }> }}
 */
export function diagnosticRtcConfiguration() {
	const configured = import.meta.env?.VITE_STUN_SERVERS;
	const urls = (configured || DEFAULT_STUN_SERVERS.join(','))
		.split(',')
		.map((/** @type {string} */ url) => url.trim())
		.filter(Boolean);

	return { iceServers: urls.map((/** @type {string} */ url) => ({ urls: url })) };
}

/**
 * @returns {{ iceServers: Array<{ urls: string[] }> }}
 */
export function rtcConfiguration() {
	if (iceMode() !== 'stun') return { iceServers: [] };

	const configured = import.meta.env?.VITE_STUN_SERVERS;
	const urls = (configured || DEFAULT_STUN_SERVERS.join(','))
		.split(',')
		.map((/** @type {string} */ url) => url.trim())
		.filter(Boolean);

	return { iceServers: [{ urls }] };
}
