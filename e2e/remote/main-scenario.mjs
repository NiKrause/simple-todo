import { mkdir, writeFile } from 'node:fs/promises';
import { TodoBrowserAgent } from './agent.mjs';

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
	const agentA = new TodoBrowserAgent('github-local', browserA, appUrl);
	const agentB = new TodoBrowserAgent(`${remoteProvider}-remote`, browserB, appUrl);
	const result = { runId, appUrl, agents: {}, replication: {}, evidence: {}, passed: false };
	result.evidence.remoteProvider = { name: remoteProvider, ...remoteEvidence };
	const requirePublicRelay = process.env.REQUIRE_PUBLIC_RELAY === 'true';

	await mkdir(outputDir, { recursive: true });

	try {
		await Promise.all([agentA.open(), agentB.open()]);
		if (requirePublicRelay) {
			const [relayOptionsA, relayOptionsB] = await Promise.all([
				agentA.waitForReachableRelayOptions(),
				agentB.waitForReachableRelayOptions()
			]);
			result.evidence.pingVerifiedRelayOptions = {
				agentA: relayOptionsA,
				agentB: relayOptionsB
			};
			await Promise.all([
				agentA.waitForPublicRelayConnection(),
				agentB.waitForPublicRelayConnection()
			]);
		}
		await Promise.all([
			agentA.waitForDialAddress({ requirePublic: requirePublicRelay }),
			agentB.waitForDialAddress({ requirePublic: requirePublicRelay })
		]);
		result.agents.a = await agentA.diagnostics();
		result.agents.b = await agentB.diagnostics();

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

		const addressForB = selectPeerDialAddress(result.agents.b, result.agents.b.peerId, {
			requirePublic: requirePublicRelay
		});
		if (!addressForB) {
			throw new Error(
				`Agent B did not advertise a public dial address for ${result.agents.b.peerId}.`
			);
		}
		await agentA.connectToMultiaddr(addressForB);
		await Promise.all([
			agentA.waitForPeerConnection(result.agents.b.peerId),
			agentB.waitForPeerConnection(result.agents.a.peerId)
		]);
		await Promise.all([agentA.waitForDatabaseSyncPeer(), agentB.waitForDatabaseSyncPeer()]);
		result.agents.a = await agentA.diagnostics();
		result.agents.b = await agentB.diagnostics();

		const aToBStarted = Date.now();
		await agentA.createTodo(todoFromA);
		await agentB.waitForTodo(todoFromA);
		result.replication.aToBMs = Date.now() - aToBStarted;

		const bToAStarted = Date.now();
		await agentB.createTodo(todoFromB);
		await agentA.waitForTodo(todoFromB);
		result.replication.bToAMs = Date.now() - bToAStarted;
		result.passed = true;
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
