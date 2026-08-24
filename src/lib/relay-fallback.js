/**
 * What to do when every baked relay is gone.
 *
 * A relay VM lives about a day; the address is baked at deploy time from a
 * probe that passed *then*. When that VM rotates, the build keeps dialling a
 * peer that no longer exists — measured on 2026-08-22 as two minutes of
 * `ERR_CONNECTION_CLOSED` and no dialable address, while two healthy relays
 * were registered on the Aleph channel the whole time.
 *
 * Baked first, discovery second, and in that order: the baked address makes
 * the first connection cheap, with no directory lookup before the app can do
 * anything. Discovery is the safety net for the day it has rotated away.
 *
 * The moving parts are injected so this can be tested without a network, and
 * so the Aleph client is only imported when it is actually needed.
 */

/** @typedef {{ address: string }} Reachable */

/**
 * @param {object} options
 * @param {() => boolean} options.isConnected has a relay connection right now
 * @param {() => Promise<string[]>} options.discover ask Aleph for candidates
 * @param {(candidates: string[]) => Promise<string[]>} options.probe keep the reachable ones
 * @param {(address: string) => Promise<unknown>} options.connect dial one
 * @param {(message: string, detail?: unknown) => void} [options.log]
 * @returns {Promise<{ outcome: 'already-connected' | 'connected' | 'none-reachable' | 'none-registered' | 'failed', address?: string, error?: unknown }>}
 */
export async function recoverRelayConnection({ isConnected, discover, probe, connect, log = () => {} }) {
	if (isConnected()) return { outcome: 'already-connected' };

	log('No relay connection from the baked addresses — asking Aleph.');

	/** @type {string[]} */
	let candidates;
	try {
		candidates = await discover();
	} catch (error) {
		log('Aleph discovery failed.', error);
		return { outcome: 'failed', error };
	}

	if (candidates.length === 0) {
		log('Aleph lists no current relay registration.');
		return { outcome: 'none-registered' };
	}

	// Re-check before spending a probe wave: the baked addresses may have come
	// up while the directory was being fetched, and dialling a second relay
	// then buys nothing.
	if (isConnected()) return { outcome: 'already-connected' };

	/** @type {string[]} */
	let reachable;
	try {
		reachable = await probe(candidates);
	} catch (error) {
		log('Probing the discovered relays failed.', error);
		return { outcome: 'failed', error };
	}

	if (reachable.length === 0) {
		log(`None of the ${candidates.length} discovered relays answered.`);
		return { outcome: 'none-reachable' };
	}

	// First reachable only. They are already ordered by the probe, and one
	// reservation is all a circuit needs — dialling the rest would spend the
	// browser's stream budget on relays nobody is going to use.
	const [address] = reachable;
	try {
		await connect(address);
		log(`Connected through a discovered relay: ${address}`);
		return { outcome: 'connected', address };
	} catch (error) {
		log('The discovered relay answered a probe but refused the dial.', error);
		return { outcome: 'failed', error };
	}
}
