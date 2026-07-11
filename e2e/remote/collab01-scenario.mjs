import { mkdir, writeFile } from 'node:fs/promises';
import { TodoBrowserAgent } from './agent.mjs';

function hasPublicRelayConnection(diagnostics) {
	return diagnostics.connections.some(({ remoteAddr }) =>
		/\/dns4\/|\/dns6\/|\/ip4\/(?!127\.)|\/ip6\//.test(remoteAddr ?? '')
	);
}

function findWebRTCPeerConnection(diagnostics, expectedPeerId) {
	return diagnostics.connections.find(
		({ remotePeer, remoteAddr }) =>
			remotePeer === expectedPeerId && remoteAddr?.toLowerCase().includes('/webrtc')
	);
}

async function waitForWebRTCPeerConnection(agentA, agentB, peerIdA, peerIdB, timeoutMs = 120_000) {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const [diagnosticsA, diagnosticsB] = await Promise.all([
			agentA.diagnostics(),
			agentB.diagnostics()
		]);
		const observedByA = findWebRTCPeerConnection(diagnosticsA, peerIdB);
		const observedByB = findWebRTCPeerConnection(diagnosticsB, peerIdA);

		if (observedByA || observedByB) {
			return {
				observedBy: observedByA ? 'agent-a' : 'agent-b',
				connection: observedByA ?? observedByB,
				diagnosticsA,
				diagnosticsB
			};
		}

		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}

	throw new Error(
		`Timed out waiting for a direct WebRTC connection between ${peerIdA} and ${peerIdB}.`
	);
}

export async function runCollab01RemoteScenario({
	browserA,
	browserB,
	appUrl,
	outputDir,
	remoteProvider = 'local'
}) {
	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	const todoFromA = `remote-${runId}-from-a`;
	const todoFromB = `remote-${runId}-from-b`;
	const agentA = new TodoBrowserAgent('github-local', browserA, appUrl);
	const agentB = new TodoBrowserAgent('testingbot-remote', browserB, appUrl);
	const result = { runId, appUrl, agents: {}, replication: {}, evidence: {}, passed: false };

	await mkdir(outputDir, { recursive: true });

	try {
		await Promise.all([agentA.open(), agentB.open()]);
		if (process.env.REQUIRE_PUBLIC_RELAY === 'true') {
			await Promise.all([
				agentA.waitForPublicRelayConnection(),
				agentB.waitForPublicRelayConnection()
			]);
		}
		result.agents.a = await agentA.diagnostics();
		result.agents.b = await agentB.diagnostics();

		if (!result.agents.a.databaseAddress || !result.agents.b.databaseAddress) {
			throw new Error('At least one collab01 agent did not expose its initial database address.');
		}
		if (result.agents.a.databaseAddress === result.agents.b.databaseAddress) {
			throw new Error(
				`collab01 agents unexpectedly opened the same initial database: ${result.agents.a.databaseAddress}`
			);
		}

		if (process.env.REQUIRE_PUBLIC_RELAY === 'true') {
			if (
				!hasPublicRelayConnection(result.agents.a) ||
				!hasPublicRelayConnection(result.agents.b)
			) {
				throw new Error('At least one browser has no observable public relay connection.');
			}
		}

		result.databaseExchange = {
			source: 'agent-a',
			address: result.agents.a.databaseAddress,
			target: 'agent-b'
		};
		await agentB.openDatabase(result.agents.a.databaseAddress);
		result.agents.b = await agentB.diagnostics();
		if (result.agents.b.databaseAddress !== result.agents.a.databaseAddress) {
			throw new Error("Agent B did not open Agent A's database through the collab01 UI.");
		}
		await Promise.all([agentA.publishOrbitDBIdentity(), agentB.publishOrbitDBIdentity()]);
		const [identityA, identityB] = await Promise.all([
			agentA.getOrbitDBIdentity(),
			agentB.getOrbitDBIdentity()
		]);
		await Promise.all([
			agentA.waitForOrbitDBIdentity(identityB?.hash),
			agentB.waitForOrbitDBIdentity(identityA?.hash)
		]);

		const webRTCObservation = await waitForWebRTCPeerConnection(
			agentA,
			agentB,
			result.agents.a.peerId,
			result.agents.b.peerId
		);
		result.directConnection = {
			transport: 'webrtc',
			observedBy: webRTCObservation.observedBy,
			...webRTCObservation.connection
		};
		result.agents.a = webRTCObservation.diagnosticsA;
		result.agents.b = webRTCObservation.diagnosticsB;

		const bToAStarted = Date.now();
		await agentB.createTodo(todoFromB);
		await agentB.announceDatabaseEntries();
		await agentA.waitForTodo(todoFromB);
		result.replication.bToAMs = Date.now() - bToAStarted;

		const aToBStarted = Date.now();
		await agentA.createTodo(todoFromA);
		await agentA.announceDatabaseEntries();
		await agentB.waitForTodo(todoFromA);
		result.replication.aToBMs = Date.now() - aToBStarted;
		result.passed = true;
		if (remoteProvider === 'testingbot') {
			await agentB.setTestingBotStatus(
				true,
				'collab01 address exchange and bidirectional OrbitDB replication passed.'
			);
			result.evidence.testingBot = await agentB.getTestingBotSessionDetails();
		}
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
		if (remoteProvider === 'testingbot') {
			await agentB.setTestingBotStatus(false, result.error).catch(() => {});
		}
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
