import { extractPeerIdFromMultiaddr } from './bootstrap-multiaddrs.js';

// Refusing to dial an AutoTLS address that a relay announced but no longer owns.
//
// AutoTLS bakes the host's IP into the certificate hostname:
// `/dns4/62-141-40-252.<key>.libp2p.direct/tcp/62227/tls/ws/p2p/<peer>`. That
// name cannot age. When the VM moves CRN or its port mapping changes, the
// record keeps resolving — to whoever holds that IP now. Measured on
// 12D3KooWNkdvDw59… (issue #154): the relay answers on
// `method-mask-alcohol-conduct.2n6.me` → 46.247.131.199 with a valid
// certificate, while its announced `62-141-40-252.…libp2p.direct` →
// 62.141.40.252 refuses the port outright and serves a stranger's self-signed
// certificate on 443. Three instances have shown this; a fourth was healthy the
// day before, so it is not a property of AutoTLS as such — it is what happens
// to an address that was correct once and was never withdrawn.
//
// The build-time resolver already drops these: it probes each candidate and
// ships only what answered. The leak is at runtime — the browser connects over
// the proxy address, learns the relay's other addresses through identify, and
// dials the dead one. libp2p authenticates by peer id, so nothing untrusted
// gets in; the cost is a dial timeout on every connect, paid against a third
// party's host.
//
// So the gate is deliberately narrow. It only refuses an IP-derived AutoTLS
// address for a peer we *already hold verified addresses for*, and only when
// this exact address is not among them. An unknown relay, a relay we have no
// snapshot for, and every other transport are none of its business — a relay
// that genuinely moved will re-register, and the next build picks that up.

const AUTOTLS_HOST = /^\/dns[46]\/([^/]+\.libp2p\.direct)\//i;

/**
 * True for the AutoTLS form whose hostname carries the host's IP.
 *
 * The first label is the dashed address — `62-141-40-252` for v4,
 * `2001-4ba0-ffe7-52-3-f431-93e1-6ad1` for v6. A `libp2p.direct` name without
 * such a label is not IP-derived and is left alone.
 *
 * @param {string} address
 * @returns {boolean}
 */
export function isIpDerivedAutoTlsAddress(address) {
	const host = AUTOTLS_HOST.exec(String(address))?.[1];
	if (!host) return false;
	const firstLabel = host.split('.')[0] ?? '';
	return /^[0-9a-f]+(-[0-9a-f]+)+$/i.test(firstLabel);
}

/**
 * The IP the hostname claims, in its usual notation — for diagnostics only, so
 * a log line can say which host the dial would have gone to.
 *
 * @param {string} address
 * @returns {string | null}
 */
export function embeddedHostAddress(address) {
	if (!isIpDerivedAutoTlsAddress(address)) return null;
	const host = AUTOTLS_HOST.exec(String(address))?.[1] ?? '';
	const label = host.split('.')[0] ?? '';
	const parts = label.split('-');
	if (parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part))) {
		return parts.join('.');
	}
	return parts.join(':');
}

/**
 * Build the `denyDialMultiaddr` predicate for the verified bootstrap set.
 *
 * @param {string[] | undefined} verifiedAddresses addresses the build-time resolver proved dialable
 * @param {{ onDeny?: (info: { address: string, peerId: string, host: string | null }) => void }} [options]
 * @returns {(address: unknown) => boolean} true when the dial should be refused
 */
export function createStaleAutoTlsGate(verifiedAddresses, { onDeny } = {}) {
	/** @type {Map<string, Set<string>>} */
	const verifiedByPeer = new Map();
	for (const address of verifiedAddresses ?? []) {
		const peerId = extractPeerIdFromMultiaddr(address);
		if (!peerId) continue;
		const existing = verifiedByPeer.get(peerId);
		if (existing) existing.add(address);
		else verifiedByPeer.set(peerId, new Set([address]));
	}

	return (address) => {
		const value = String(address);
		if (!isIpDerivedAutoTlsAddress(value)) return false;

		const peerId = extractPeerIdFromMultiaddr(value);
		if (!peerId) return false;

		const verified = verifiedByPeer.get(peerId);
		// A relay we have no verified snapshot for is not ours to judge.
		if (!verified || verified.size === 0) return false;
		if (verified.has(value)) return false;

		onDeny?.({ address: value, peerId, host: embeddedHostAddress(value) });
		return true;
	};
}
