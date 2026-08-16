import { writeFile } from 'node:fs/promises';
import { PLAYWRIGHT_RUNNER_VERSION } from '@le-space/playwright';
import { createAlephBrowser, createLocalBrowser } from './providers.mjs';
import { runQr01RemoteScenario } from './qr01-scenario.mjs';

const appUrl = process.env.REMOTE_APP_URL || 'https://qr01.le-space.de';
const provider = process.env.REMOTE_PROVIDER || 'aleph';
const outputDir = process.env.REMOTE_OUTPUT_DIR || 'test-results/remote-qr01';

const browserA = await createLocalBrowser();
let browserB;
try {
	if (provider === 'aleph') {
		browserB = await createAlephBrowser({
			wsEndpoint: process.env.ALEPH_PLAYWRIGHT_WS_ENDPOINT,
			versionUrl: process.env.ALEPH_PLAYWRIGHT_VERSION_URL,
			secret: process.env.ALEPH_PLAYWRIGHT_SECRET
		});
	} else if (provider === 'local') {
		browserB = await createLocalBrowser();
	} else {
		throw new Error(`Unsupported REMOTE_PROVIDER "${provider}". Use aleph or local.`);
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
				playwrightVersion: PLAYWRIGHT_RUNNER_VERSION
			}
		: {};

const githubRunUrl = process.env.GITHUB_RUN_ID
	? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
	: null;

try {
	const result = await runQr01RemoteScenario({
		browserA,
		browserB,
		appUrl,
		outputDir,
		remoteProvider: provider,
		remoteEvidence
	});
	result.evidence.githubRunUrl = githubRunUrl;
	console.log(JSON.stringify(result, null, 2));
	if (process.env.GITHUB_STEP_SUMMARY) {
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`## Remote QR handover — qr01\n\n` +
				`**Result:** ✅ passed\n\n` +
				`Two browsers on different networks, introduced by nothing but the ` +
				`scanned payload. No relay, no bootstrap address, no discovery.\n\n` +
				`| Evidence | Agent A | Agent B |\n| --- | --- | --- |\n` +
				`| Provider | GitHub/local Playwright | ${provider} |\n` +
				`| Peer ID | \`${result.agents.a.peerId}\` | \`${result.agents.b.peerId}\` |\n` +
				`| Own list | \`${result.mnemonics?.a ?? '—'}\` | \`${result.mnemonics?.b ?? '—'}\` |\n` +
				`| Offer / answer | ${result.handover.offerBytes} bytes | ${result.handover.answerBytes} bytes |\n` +
				`| Connected after | ${result.handover.connectedMs} ms | — |\n` +
				`| Ten items replicated in | — | ${result.handover.replicationMs} ms |\n\n` +
				`ICE: \`?ice=stun\`. The chapter's default is host candidates only, ` +
				`which cannot cross networks by construction — this run proves the ` +
				`documented exception, not the construction-site default.\n\n` +
				(githubRunUrl ? `- [GitHub workflow run](${githubRunUrl})\n` : '') +
				(provider === 'aleph'
					? `- Aleph INSTANCE: \`${remoteEvidence.instanceHash ?? 'unknown'}\`\n- CRN/region: \`${remoteEvidence.crnName ?? remoteEvidence.crnHash ?? 'unknown'}\` / \`${remoteEvidence.region ?? 'unknown'}\`\n- Playwright: \`${PLAYWRIGHT_RUNNER_VERSION}\`\n`
					: ''),
			{ flag: 'a' }
		);
	}
} catch (error) {
	const result = error?.result;
	if (process.env.GITHUB_STEP_SUMMARY) {
		await writeFile(
			process.env.GITHUB_STEP_SUMMARY,
			`## Remote QR handover — qr01\n\n` +
				`**Result:** ❌ failed\n\n` +
				`**Stage:** \`${result?.evidence?.stage ?? 'unknown'}\`\n\n` +
				`**Reason:** ${result?.error ?? error?.message ?? String(error)}\n\n` +
				`Screenshots and result JSON are in the workflow artifact.\n`,
			{ flag: 'a' }
		);
	}
	throw error;
} finally {
	await Promise.allSettled([browserA.close(), browserB.close()]);
}
