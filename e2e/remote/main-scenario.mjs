import { mkdir, writeFile } from 'node:fs/promises';
import { TodoBrowserAgent, remoteProgress } from './agent.mjs';

function hasPublicRelayConnection(diagnostics) {
	return diagnostics.connections.some(({ remoteAddr }) =>
		/\/dns4\/|\/dns6\/|\/ip4\/(?!127\.)|\/ip6\//.test(remoteAddr ?? '')
	);
}

/**
 * Gate on "this browser can reach a public relay" — as a property that has to
 * hold, not as a value read once.
 *
 * The old check tested the snapshot taken at `verifying-relays`, several
 * seconds after `waitForPublicRelayConnection()` had already polled the same
 * condition true. Instrumenting `connection:open`/`close` showed what happens
 * in between: right after the two browsers upgrade to a direct WebRTC
 * connection, the circuit connection closes and the relay connection closes
 * with it — and reopens ~200 ms later.
 *
 *   10:40:54.092 open  direct  <peer>    WebRTC upgrade
 *   10:40:54.680 close limited <peer>    circuit no longer needed
 *   10:40:54.730 close direct  <relay>   relay link dropped
 *   10:40:54.933 open  direct  <relay>   and back
 *
 * A snapshot landing in that ~200 ms hole reported zero connections and failed
 * the run, which is exactly the recurring CI shape (`verifying-relays` at
 * 10:19:53, `(0 connections)` and FAILED at 10:19:55). Nothing was actually
 * wrong: the link is re-established on its own and stays up — after the
 * reopen above there was not one further connection event in two minutes.
 *
 * So re-poll instead of trusting the sample, and keep the specific error for
 * the case where the connection really is gone for good.
 */
async function confirmPublicRelayConnection(agent, snapshot) {
	if (hasPublicRelayConnection(snapshot)) return snapshot;

	remoteProgress(
		`${agent.name}: no public relay connection in this sample — re-polling before failing.`
	);
	try {
		return await agent.waitForPublicRelayConnection();
	} catch {
		throw new Error('At least one browser has no observable public relay connection.');
	}
}

export function selectPeerDialAddress(
	diagnostics,
	expectedPeerId,
	{ requirePublic = false, relayPeerId = null } = {}
) {
	const candidates = diagnostics.multiaddrs.filter(
		(address) =>
			address.endsWith(`/p2p/${expectedPeerId}`) &&
			(!relayPeerId || address.includes(`/p2p/${relayPeerId}/p2p-circuit/`)) &&
			(!requirePublic ||
				/\/dns[46]\//.test(address) ||
				/\/ip4\/(?!127\.)/.test(address) ||
				/\/ip6\/(?!::1\/)/.test(address))
	);

	return (
		candidates.find((address) => address.includes('/p2p-circuit/webrtc/')) ??
		candidates.find((address) => address.includes('/p2p-circuit/')) ??
		candidates.find((address) => address.includes('/webrtc-direct/')) ??
		candidates[0] ??
		null
	);
}

/**
 * Ask each browser for the blocks its own log is waiting on.
 *
 * A head's `next` hashes are exactly what a traversal reaches for, so probing
 * them turns "something could not be loaded" into a named block with a time
 * against it — and doing it on *both* browsers says whether the block is
 * unreachable everywhere or only from where the walk is stuck.
 *
 * Best-effort throughout: this runs while a run is already failing, and a probe
 * that itself falls over must not replace the failure that was being reported.
 *
 * @param {TodoBrowserAgent} agentA
 * @param {TodoBrowserAgent} agentB
 * @param {any} result
 */
async function probeStuckHeads(agentA, agentB, result) {
	/** @type {any[]} */
	const probes = [];
	for (const [name, agent, diagnostics] of /** @type {const} */ ([
		['agentA', agentA, result.agents.a],
		['agentB', agentB, result.agents.b]
	])) {
		const heads = diagnostics?.logHeads ?? [];
		const wanted = [...new Set(heads.flatMap((/** @type {any} */ head) => head.next ?? []))];
		remoteProgress(`${name} log heads: ${heads.length}, next hashes: ${wanted.length}`);
		for (const hash of wanted.slice(0, 3)) {
			const probe = await agent.probeBlock(hash).catch((/** @type {any} */ error) => ({
				ok: false,
				ms: null,
				error: error instanceof Error ? error.message : String(error)
			}));
			remoteProgress(
				`${name} block ${hash.slice(-8)}: ${probe?.ok ? `ok in ${probe.ms} ms` : `failed after ${probe?.ms} ms — ${probe?.error}`}`
			);
			probes.push({ agent: name, hash, ...probe });
		}
	}
	return probes;
}

export async function runMainRemoteScenario({
	browserA,
	browserB,
	appUrl,
	outputDir,
	remoteProvider = 'local',
	remoteEvidence = {}
}) {
	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const todoFromA = `remote-${runId}-from-a`;
	const todoFromB = `remote-${runId}-from-b`;
	const agentA = new TodoBrowserAgent('github-local', browserA, appUrl);
	const agentB = new TodoBrowserAgent(`${remoteProvider}-remote`, browserB, appUrl);
	const result = { runId, appUrl, agents: {}, replication: {}, evidence: {}, passed: false };
	result.evidence.remoteProvider = { name: remoteProvider, ...remoteEvidence };
	const requirePublicRelay = process.env.REQUIRE_PUBLIC_RELAY === 'true';
	const setStage = (stage, detail = '') => {
		result.evidence.stage = stage;
		remoteProgress(`stage: ${stage}${detail ? ` (${detail})` : ''}`);
	};
	setStage(
		'opening-browsers',
		`provider=${remoteProvider}, requirePublicRelay=${requirePublicRelay}`
	);

	await mkdir(outputDir, { recursive: true });

	try {
		await Promise.all([agentA.open(), agentB.open()]);
		setStage('verifying-relays');
		if (requirePublicRelay) {
			const [relayOptionsA, relayOptionsB] = await Promise.all([
				agentA.waitForReachableRelayOptions(),
				agentB.waitForReachableRelayOptions()
			]);
			result.evidence.pingVerifiedRelayOptions = {
				agentA: relayOptionsA,
				agentB: relayOptionsB
			};
			remoteProgress(
				`relay options: agentA=[${relayOptionsA.map(({ label }) => label).join(', ')}] agentB=[${relayOptionsB.map(({ label }) => label).join(', ')}]`
			);
			remoteProgress('waiting for a public relay connection on both browsers...');
			await Promise.all([
				agentA.waitForPublicRelayConnection(),
				agentB.waitForPublicRelayConnection()
			]);
		}
		remoteProgress('waiting for dialable peer addresses on both browsers...');
		await Promise.all([
			agentA.waitForDialAddress({ requirePublic: requirePublicRelay }),
			agentB.waitForDialAddress({ requirePublic: requirePublicRelay })
		]);
		result.agents.a = await agentA.diagnostics();
		result.agents.b = await agentB.diagnostics();
		remoteProgress(
			`peers: agentA=${result.agents.a.peerId} (${result.agents.a.connections.length} connections), agentB=${result.agents.b.peerId} (${result.agents.b.connections.length} connections)`
		);
		// The measurement: how long did the relay link actually live? Printed
		// before the assertions below so it survives a failure at any of them.
		for (const [name, agent] of [
			['agentA', result.agents.a],
			['agentB', result.agents.b]
		]) {
			const events = agent.connectionEvents ?? [];
			remoteProgress(`${name} connection events (${events.length}):`);
			for (const e of events.slice(-12)) {
				remoteProgress(
					`   ${new Date(e.at).toISOString().slice(11, 23)} ${e.event} ${e.detail ?? ''} ${(e.peer || '').slice(-6)}`
				);
			}
		}

		setStage('validating-shared-database');

		if (
			!result.agents.a.databaseAddress ||
			result.agents.a.databaseAddress !== result.agents.b.databaseAddress
		) {
			throw new Error(
				`main agents opened different databases: ${result.agents.a.databaseAddress} vs ${result.agents.b.databaseAddress}`
			);
		}

		if (requirePublicRelay) {
			result.agents.a = await confirmPublicRelayConnection(agentA, result.agents.a);
			result.agents.b = await confirmPublicRelayConnection(agentB, result.agents.b);
		}

		// A direct browser-to-browser WebRTC connection is welcome but NOT
		// required: OrbitDB sync runs over gossipsub on the relay circuit
		// (`runOnLimitedConnection: true`), so the todo replicates relay-mediated
		// even when the (slower/absent) direct dial never completes — proven by
		// the UC cross-host run (<0.3 s over a single relay). Attempt the direct
		// connection best-effort, then gate on the real signal: the todo actually
		// replicating.
		setStage('connecting-browser-peers');
		const addressForB = selectPeerDialAddress(result.agents.b, result.agents.b.peerId, {
			requirePublic: requirePublicRelay
		});
		if (addressForB) {
			remoteProgress(`agent A dialing agent B via ${addressForB} (best-effort)`);
			await agentA
				.connectToMultiaddr(addressForB)
				.catch((error) =>
					remoteProgress(
						`direct dial did not complete, continuing relay-mediated: ${error instanceof Error ? error.message : String(error)}`
					)
				);
			await Promise.allSettled([
				agentA.waitForPeerConnection(result.agents.b.peerId, 30_000),
				agentB.waitForPeerConnection(result.agents.a.peerId, 30_000)
			]);
		} else {
			remoteProgress(
				`agent B advertised no direct dial address for ${result.agents.b.peerId}; relying on relay-mediated replication`
			);
		}
		// Do NOT hard-gate on a database sync peer before the first todo exists.
		// The relay only joins a database when the app's replication-proof flow
		// runs on a todo (POST /pinning/sync in verifyRelayReplication) — so on a
		// fresh database (or a freshly redeployed relay with an empty datastore)
		// the only pre-todo path to a sync peer is the best-effort direct dial
		// above, which routinely fails between NAT'd CI browsers. That made this
		// stage fail deterministically on collab01 (fresh mnemonic database every
		// run) and sporadically on main right after relay redeploys. Probe briefly
		// for the fast path, then let the replication assertions below be the real
		// gate: creating the first todo triggers the relay join, and waitForTodo
		// proves the mesh either way.
		const earlySyncPeers = await Promise.allSettled([
			agentA.waitForDatabaseSyncPeer(30_000),
			agentB.waitForDatabaseSyncPeer(30_000)
		]);
		remoteProgress(
			`pre-todo database sync peers (informational): agentA=${
				earlySyncPeers[0].status === 'fulfilled' ? 'yes' : 'not yet'
			} agentB=${earlySyncPeers[1].status === 'fulfilled' ? 'yes' : 'not yet'}`
		);
		result.agents.a = await agentA.diagnostics();
		result.agents.b = await agentB.diagnostics();
		// Condensed pubsub view per agent: whether the database topic is
		// subscribed and who sits in its gossipsub mesh. Live head propagation
		// depends on exactly this, and it has failed while everything else
		// (connections, sync peers, relay pinning) looked healthy.
		for (const [label, agent] of [
			['agentA', result.agents.a],
			['agentB', result.agents.b]
		]) {
			const pubsub = agent.pubsub;
			if (!pubsub) {
				remoteProgress(`${label} pubsub state: unavailable (older app build?)`);
				continue;
			}
			const dbTopic = pubsub.topics.find((topic) => topic.includes('/orbitdb/')) ?? null;
			remoteProgress(
				`${label} pubsub: topics=${pubsub.topics.length} peers=[${pubsub.peers
					.map((peer) => peer.slice(-6))
					.join(',')}] dbTopic=${dbTopic ? 'subscribed' : 'MISSING'} dbMesh=[${(
					(dbTopic && pubsub.mesh[dbTopic]) ||
					[]
				)
					.map((peer) => peer.slice(-6))
					.join(',')}] dbSubscribers=[${((dbTopic && pubsub.subscribers[dbTopic]) || [])
					.map((peer) => peer.slice(-6))
					.join(',')}]`
			);
		}

		setStage('creating-todo-on-agent-a');
		const aToBStarted = Date.now();
		await agentA.createTodo(todoFromA);
		setStage('replicating-agent-a-to-agent-b');
		await agentB.waitForTodo(todoFromA);
		result.replication.aToBMs = Date.now() - aToBStarted;
		remoteProgress(`replicated A -> B in ${result.replication.aToBMs} ms`);

		const bToAStarted = Date.now();
		setStage('creating-todo-on-agent-b');
		await agentB.createTodo(todoFromB);
		setStage('replicating-agent-b-to-agent-a');
		await agentA.waitForTodo(todoFromB);
		result.replication.bToAMs = Date.now() - bToAStarted;
		remoteProgress(`replicated B -> A in ${result.replication.bToAMs} ms`);
		result.passed = true;
		setStage('completed');
		await Promise.all([
			agentA.screenshot(`${outputDir}/agent-a-success.png`),
			agentB.screenshot(`${outputDir}/agent-b-success.png`)
		]);
		result.evidence.screenshots = ['agent-a-success.png', 'agent-b-success.png'];
		return result;
	} catch (error) {
		const [diagnosticsA, diagnosticsB] = await Promise.allSettled([
			agentA.diagnostics(),
			agentB.diagnostics()
		]);
		if (diagnosticsA.status === 'fulfilled') result.agents.a = diagnosticsA.value;
		if (diagnosticsB.status === 'fulfilled') result.agents.b = diagnosticsB.value;
		result.error = error instanceof Error ? error.message : String(error);
		remoteProgress(`FAILED at stage "${result.evidence.stage}": ${result.error}`);
		for (const [name, agent] of [
			['agentA', result.agents.a],
			['agentB', result.agents.b]
		]) {
			const events = agent?.connectionEvents ?? [];
			remoteProgress(`${name} connection events at failure (${events.length}):`);
			for (const e of events.slice(-12)) {
				remoteProgress(
					`   ${new Date(e.at).toISOString().slice(11, 23)} ${e.event} ${e.detail ?? ''} ${(e.peer || '').slice(-6)}`
				);
			}
		}
		remoteProgress(
			`todos rendered at failure: agentA=${result.agents.a?.todoCount ?? '?'} agentB=${result.agents.b?.todoCount ?? '?'}`
		);
		result.evidence.blockProbes = await probeStuckHeads(agentA, agentB, result);
		await Promise.allSettled([
			agentA.screenshot(`${outputDir}/agent-a-failure.png`),
			agentB.screenshot(`${outputDir}/agent-b-failure.png`)
		]);
		throw Object.assign(error instanceof Error ? error : new Error(result.error), { result });
	} finally {
		await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
		await Promise.allSettled([agentA.close(), agentB.close()]);
	}
}
