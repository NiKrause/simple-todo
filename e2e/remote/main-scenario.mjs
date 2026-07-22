import { mkdir, writeFile } from 'node:fs/promises';
import { TodoBrowserAgent, remoteProgress } from './agent.mjs';
import { generateSpanishMnemonic } from '../../src/lib/spanish-mnemonic.js';

function hasPublicRelayConnection(diagnostics) {
	return diagnostics.connections.some(({ remoteAddr }) =>
		/\/dns4\/|\/dns6\/|\/ip4\/(?!127\.)|\/ip6\//.test(remoteAddr ?? '')
	);
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
	// Chapter-specific: both browsers open the same Spanish-mnemonic-named shared
	// OrbitDB list and replicate through it.
	const sharedMnemonic = generateSpanishMnemonic();
	const agentA = new TodoBrowserAgent('github-local', browserA, appUrl);
	const agentB = new TodoBrowserAgent(`${remoteProvider}-remote`, browserB, appUrl);
	const result = {
		runId,
		appUrl,
		sharedMnemonic,
		agents: {},
		replication: {},
		evidence: {},
		passed: false
	};
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
		await Promise.all([agentA.open(sharedMnemonic), agentB.open(sharedMnemonic)]);
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
		setStage('validating-shared-database');

		if (
			result.agents.a.databaseName !== sharedMnemonic ||
			result.agents.b.databaseName !== sharedMnemonic
		) {
			throw new Error(
				`agents did not open the shared mnemonic list "${sharedMnemonic}": agentA=${result.agents.a.databaseName}, agentB=${result.agents.b.databaseName}`
			);
		}
		if (
			!result.agents.a.databaseAddress ||
			result.agents.a.databaseAddress !== result.agents.b.databaseAddress
		) {
			throw new Error(
				`main agents opened different databases: ${result.agents.a.databaseAddress} vs ${result.agents.b.databaseAddress}`
			);
		}

		if (requirePublicRelay) {
			if (
				!hasPublicRelayConnection(result.agents.a) ||
				!hasPublicRelayConnection(result.agents.b)
			) {
				throw new Error('At least one browser has no observable public relay connection.');
			}
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
