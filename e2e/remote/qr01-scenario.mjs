import { mkdir, writeFile } from 'node:fs/promises';
import { TodoBrowserAgent, remoteProgress } from './agent.mjs';
import { SITE_TODOS } from '../../src/lib/site-todos.js';
import { openListTab } from '../open-app.mjs';
import { generateSpanishMnemonic } from '../../src/lib/spanish-mnemonic.js';

/**
 * The link input is rendered as soon as the panel opens, but its value is empty
 * until the session has gathered its candidates — with `?ice=stun` that is a
 * round trip to a STUN server, not instant. Waiting for the element would
 * therefore read `''` and hand an empty fragment to the other side.
 *
 * @param {import('@playwright/test').Locator} locator
 * @param {number} timeout
 * @returns {Promise<string>}
 */
async function waitForInviteLink(locator, timeout) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = await locator.inputValue();
		if (value && new URL(value).hash.length > 'invite='.length + 1) return value;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error('invite link never carried a payload');
}

/**
 * The chapter's own claim, stretched across two networks.
 *
 * `main`'s remote scenario introduces its two browsers through a public relay:
 * it waits for `waitForPublicRelayConnection()` on both, which comes from an
 * address baked into the build. qr01 bakes none, so that scenario cannot run
 * here — and importing it would be testing another chapter's premise anyway.
 *
 * This one introduces them the way the chapter says people do: one side draws a
 * code, the other scans it, and the harness carries the string between them
 * exactly as a phone camera would. No relay, no bootstrap list, no discovery.
 * `e2e/qr01-transfer.spec.js` already proves that between two contexts of one
 * browser; the only thing this adds is real distance, which is the one part a
 * single machine cannot fake.
 *
 * ## Why `?ice=stun`, and what that costs the claim
 *
 * `ice-mode.js` defaults to host candidates only, deliberately: a QR payload
 * cannot trickle, so the whole candidate set must be gathered before the code
 * can be drawn, and unreachable STUN servers would make someone on a building
 * site wait 15 s for a code. Host candidates need no server and two devices on
 * one hotspot reach each other with nothing else.
 *
 * Two devices on *different* networks cannot, and the file says so: `?ice=stun`
 * exists "for the case the chapter does not cover". This scenario is that case.
 * So it proves the escape hatch works across the internet — **not** that the
 * construction-site default does. That default cannot work here by
 * construction, and a green run must not be read as saying otherwise.
 */
export async function runQr01RemoteScenario({
	browserA,
	browserB,
	appUrl,
	outputDir = 'test-results/remote-qr01',
	timeout = 120_000,
	remoteProvider = 'local',
	remoteEvidence = {}
}) {
	const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	// Both sides need ICE servers to find each other at all across networks.
	const iceUrl = appUrl.includes('?') ? `${appUrl}&ice=stun` : `${appUrl}?ice=stun`;
	const agentA = new TodoBrowserAgent('github-local', browserA, iceUrl, timeout);
	const agentB = new TodoBrowserAgent(`${remoteProvider}-remote`, browserB, iceUrl, timeout);
	const result = {
		runId,
		appUrl: iceUrl,
		transport: 'webrtc-qr',
		agents: {},
		handover: {},
		evidence: {},
		passed: false
	};
	result.evidence.remoteProvider = { name: remoteProvider, ...remoteEvidence };
	const setStage = (stage, detail = '') => {
		result.evidence.stage = stage;
		remoteProgress(`stage: ${stage}${detail ? ` (${detail})` : ''}`);
	};

	await mkdir(outputDir, { recursive: true });

	try {
		setStage('opening-browsers', `provider=${remoteProvider}, ice=stun`);
		// A *distinct* mnemonic each, unlike main's scenario where both open the
		// same named list. Here the two sides must start as strangers: the whole
		// claim is that one private list crosses over by way of the scanned code,
		// and starting them on a common list would hand them a second route to
		// the same data. `open()` writes its argument to localStorage unguarded,
		// so omitting it would store the string "undefined" as the mnemonic.
		result.mnemonics = { a: generateSpanishMnemonic(), b: generateSpanishMnemonic() };
		// No relay for either side: this scenario introduces the two through the
		// scanned payload and ends by asserting none was used.
		await Promise.all([
			agentA.open(result.mnemonics.a, { relayOptIn: false }),
			agentB.open(result.mnemonics.b, { relayOptIn: false })
		]);

		setStage('seeding-site-list-on-a');
		await openListTab(agentA.page, 'create');
		await agentA.page.getByTestId('new-list-seed-site').click();
		await agentA.page.getByTestId('new-list-created').waitFor({ state: 'visible', timeout });
		await agentA.page
			.getByText(SITE_TODOS[0], { exact: true })
			.first()
			.waitFor({ state: 'visible', timeout });

		setStage('handover-by-link');
		const started = Date.now();
		// Seeding the list moved A onto the "make a list" tab; the transfer
		// controls are hidden until it comes back.
		await openListTab(agentA.page, 'transfer');
		await openListTab(agentB.page, 'transfer');
		await agentA.page.getByTestId('qr-transfer-start').click();

		// Driven through the invite link, not the `__simpleTodoQr` debug handle.
		// That handle only exists under `VITE_E2E`, so a scenario built on it can
		// never run against the artifact that is actually deployed — which is the
		// one thing this test is for. The link is a real feature of the app, read
		// out of the DOM exactly as a person would copy it.
		const linkOnA = agentA.page.getByTestId('qr-transfer-link');
		await linkOnA.waitFor({ state: 'attached', timeout });
		const offerLink = await waitForInviteLink(linkOnA, timeout);
		result.handover.offerBytes = offerLink.length;
		remoteProgress(`offer link on A (${offerLink.length} bytes), opening it on B`);

		// Bob opens the link he was sent, which is a fresh load carrying the
		// fragment — the way anyone receiving one would.
		await agentB.page.goto(offerLink, { waitUntil: 'domcontentloaded', timeout });
		const linkOnB = agentB.page.getByTestId('qr-transfer-link');
		await linkOnB.waitFor({ state: 'attached', timeout });
		const answerLink = await waitForInviteLink(linkOnB, timeout);
		result.handover.answerBytes = answerLink.length;
		remoteProgress(`answer link on B (${answerLink.length} bytes), returning it to A`);

		// The return leg sets the fragment on the page Alice already has open.
		// A reload here would take her libp2p node and the seeded list with it,
		// so this must stay a same-document navigation: `location.hash` fires
		// `hashchange`, which is what QrTransfer listens for.
		const answerFragment = new URL(answerLink).hash;
		await agentA.page.evaluate((hash) => {
			window.location.hash = hash;
		}, answerFragment);

		await agentA.page.getByTestId('qr-transfer-connected').waitFor({ state: 'visible', timeout });
		result.handover.connectedMs = Date.now() - started;
		remoteProgress(`connected after ${result.handover.connectedMs} ms`);

		setStage('accepting-list-offer-on-b');
		// Bob is asked, not told — an address arriving is not consent to replicate.
		const dialog = agentB.page.getByTestId('list-offer-dialog');
		await dialog.waitFor({ state: 'visible', timeout });
		await agentB.page.getByTestId('list-offer-accept').click();
		await dialog.waitFor({ state: 'hidden', timeout });

		setStage('replicating-list-to-b');
		const replicationStarted = Date.now();
		for (const todo of SITE_TODOS) {
			await agentB.page
				.getByText(todo, { exact: true })
				.first()
				.waitFor({ state: 'visible', timeout });
		}
		result.handover.replicationMs = Date.now() - replicationStarted;

		setStage('verifying-no-relay');
		result.agents.a = await agentA.diagnostics();
		result.agents.b = await agentB.diagnostics();
		// The claim asserted rather than assumed: each is connected to exactly the
		// peer on the other end of the code, and to nothing else.
		const peersA = result.agents.a.connections.map(({ remotePeer }) => remotePeer).filter(Boolean);
		const peersB = result.agents.b.connections.map(({ remotePeer }) => remotePeer).filter(Boolean);
		if (!peersA.includes(result.agents.b.peerId) || !peersB.includes(result.agents.a.peerId)) {
			throw new Error(
				`browsers are not connected to each other: A sees [${peersA.join(', ')}], B sees [${peersB.join(', ')}]`
			);
		}
		const strangersA = peersA.filter((peer) => peer !== result.agents.b.peerId);
		const strangersB = peersB.filter((peer) => peer !== result.agents.a.peerId);
		if (strangersA.length || strangersB.length) {
			throw new Error(
				`a third party is in the conversation — A: [${strangersA.join(', ')}], B: [${strangersB.join(', ')}]`
			);
		}

		setStage('completed');
		result.passed = true;
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
