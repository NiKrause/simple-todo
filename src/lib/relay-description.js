/**
 * What to say about the relay connection, assembled from what is known.
 *
 * The one step description that cannot simply be looked up: it names the
 * relay's health origin and, when the relay reports one, its version. A
 * catalogue can hold the sentences; it cannot hold the values.
 *
 * Extracted from `P2PStatusNav` when the app learned a second language — six
 * branches inline in a component are six branches nobody tests. Here they take
 * the translator as an argument and are a plain function of their inputs.
 *
 * @param {any} t the translator, `$_` from svelte-i18n
 * @param {object} state
 * @param {boolean} state.connected whether a relay connection exists at all
 * @param {string | null} state.origin the HTTPS origin its health is read from
 * @param {'idle' | 'loading' | 'verified' | 'failed' | string} state.health
 * @param {string | null} state.version the OrbitDB relay version, when it says
 * @returns {string}
 */
export function relayDescription(t, { connected, origin, health, version }) {
	const base = t('status.relay.base');

	if (!connected) return `${base} ${t('status.relay.none')}`;
	if (!origin) return `${base} ${t('status.relay.noHealthUrl')}`;
	if (health === 'loading') return `${base} ${t('status.relay.loading', { values: { origin } })}`;
	if (health === 'verified' && version) {
		return `${base} ${t('status.relay.verifiedVersion', { values: { origin, version } })}`;
	}
	if (health === 'verified') {
		return `${base} ${t('status.relay.verifiedNoVersion', { values: { origin } })}`;
	}
	return `${base} ${t('status.relay.unverified', { values: { origin } })}`;
}
