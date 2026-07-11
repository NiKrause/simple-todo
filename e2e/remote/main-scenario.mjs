import { mkdir, writeFile } from 'node:fs/promises';
import { TodoBrowserAgent } from './agent.mjs';

function hasPublicRelayConnection(diagnostics) {
	return diagnostics.connections.some(({ remoteAddr }) =>
		/\/dns4\/|\/dns6\/|\/ip4\/(?!127\.)|\/ip6\//.test(remoteAddr ?? '')
	);
}

export async function runMainRemoteScenario({
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
	const result = { runId, appUrl, agents: {}, replication: {}, passed: false };

	await mkdir(outputDir, { recursive: true });

	try {
		await Promise.all([agentA.open(), agentB.open()]);
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

		if (process.env.REQUIRE_PUBLIC_RELAY === 'true') {
			if (
				!hasPublicRelayConnection(result.agents.a) ||
				!hasPublicRelayConnection(result.agents.b)
			) {
				throw new Error('At least one browser has no observable public relay connection.');
			}
		}

		const aToBStarted = Date.now();
		await agentA.createTodo(todoFromA);
		await agentB.waitForTodo(todoFromA);
		result.replication.aToBMs = Date.now() - aToBStarted;

		const bToAStarted = Date.now();
		await agentB.createTodo(todoFromB);
		await agentA.waitForTodo(todoFromB);
		result.replication.bToAMs = Date.now() - bToAStarted;
		result.passed = true;
		if (remoteProvider === 'testingbot') {
			await agentB.setTestingBotStatus(true, 'Bidirectional OrbitDB replication passed.');
		}
		return result;
	} catch (error) {
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
