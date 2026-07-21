import { writeFile } from 'node:fs/promises';
import {
	createAlephBrowser,
	createLocalBrowser,
	createTestingBotBrowser,
	PLAYWRIGHT_VERSION
} from './providers.mjs';
import { runMainRemoteScenario } from './main-scenario.mjs';

const appUrl = process.env.REMOTE_APP_URL || 'https://simple-todo.le-space.de';
const provider = process.env.REMOTE_PROVIDER || 'aleph';
const outputDir = process.env.REMOTE_OUTPUT_DIR || 'test-results/remote-main';
const buildName = process.env.GITHUB_RUN_ID
	? `simple-todo-${process.env.GITHUB_RUN_ID}`
	: `simple-todo-${Date.now()}`;

const browserA = await createLocalBrowser();
let browserB;
try {
	if (provider === 'testingbot') {
		browserB = await createTestingBotBrowser({
			key: process.env.TESTINGBOT_KEY,
			secret: process.env.TESTINGBOT_SECRET,
			buildName,
			testName: 'main cross-network OrbitDB replication'
		});
	} else if (provider === 'aleph') {
		browserB = await createAlephBrowser({
			wsEndpoint: process.env.ALEPH_PLAYWRIGHT_WS_ENDPOINT,
			versionUrl: process.env.ALEPH_PLAYWRIGHT_VERSION_URL,
			secret: process.env.ALEPH_PLAYWRIGHT_SECRET
		});
	} else if (provider === 'local') {
		browserB = await createLocalBrowser();
	} else {
		throw new Error(`Unsupported REMOTE_PROVIDER "${provider}". Use aleph, local, or testingbot.`);
	}
} catch (error) {
	await browserA.close();
	throw error;
}

const remoteEvidence =
	provider === 'aleph'
		? {
				instanceHash: process.env.ALEPH_PLAYWRIGHT_INSTANCE_HASH ?? null,
				crnHash: process.env.ALEPH_PLAYWRIGHT_CRN_HASH ?? null,
				crnName: process.env.ALEPH_PLAYWRIGHT_CRN_NAME ?? null,
				region: process.env.ALEPH_PLAYWRIGHT_REGION ?? null,
				playwrightVersion: PLAYWRIGHT_VERSION
			}
		: {};

try {
	const result = await runMainRemoteScenario({
		browserA,
		browserB,
		appUrl,
		outputDir,
		remoteProvider: provider,
		remoteEvidence
	});
	const githubRunUrl = process.env.GITHUB_RUN_ID
		? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
		: null;
	const githubArtifactsUrl = githubRunUrl ? `${githubRunUrl}#artifacts` : null;
	result.evidence.githubRunUrl = githubRunUrl;
	result.evidence.githubArtifactsUrl = githubArtifactsUrl;
	console.log(JSON.stringify(result, null, 2));
	if (process.env.GITHUB_STEP_SUMMARY) {
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`## Remote OrbitDB replication — main\n\n` +
				`**Result:** ✅ passed\n\n` +
				`| Evidence | Agent A | Agent B |\n| --- | --- | --- |\n` +
				`| Provider | GitHub/local Playwright | ${provider} |\n` +
				`| Shared mnemonic | \`${result.sharedMnemonic}\` | \`${result.sharedMnemonic}\` |\n` +
				`| Peer ID | \`${result.agents.a.peerId}\` | \`${result.agents.b.peerId}\` |\n` +
				`| OrbitDB address | \`${result.agents.a.databaseAddress}\` | \`${result.agents.b.databaseAddress}\` |\n` +
				`| A → B replication | ${result.replication.aToBMs} ms | observed |\n` +
				`| B → A replication | observed | ${result.replication.bToAMs} ms |\n\n` +
				`### Evidence\n\n` +
				(githubRunUrl ? `- [GitHub workflow run](${githubRunUrl})\n` : '') +
				(githubArtifactsUrl
					? `- [Success screenshots and result JSON](${githubArtifactsUrl})\n`
					: '') +
				(provider === 'aleph'
					? `- Aleph INSTANCE: \`${remoteEvidence.instanceHash ?? 'unknown'}\`\n- CRN/region: \`${remoteEvidence.crnName ?? remoteEvidence.crnHash ?? 'unknown'}\` / \`${remoteEvidence.region ?? 'unknown'}\`\n- Playwright: \`${PLAYWRIGHT_VERSION}\`\n`
					: ''),
			{ flag: 'a' }
		);
	}
} catch (error) {
	const result = error?.result;
	if (process.env.GITHUB_STEP_SUMMARY) {
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`## Remote OrbitDB replication — main\n\n` +
				`**Result:** ❌ failed\n\n` +
				`**Reason:** ${result?.error ?? error?.message ?? String(error)}\n\n` +
				`Detailed diagnostics and screenshots are available in the workflow artifact.\n`,
			{ flag: 'a' }
		);
	}
	throw error;
} finally {
	await Promise.allSettled([browserA.close(), browserB.close()]);
}
